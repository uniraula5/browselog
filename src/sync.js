import { allVisits, adoptRemoteLabels, deleteVisit, markUploaded } from './storage.js';
import {
  currentSession, deleteCloudVisit, listCloudDeletions, listCloudVisits,
  uploadVisit, writeCloudDeletion
} from './cloud.js';

let running;

export async function deviceId() {
  const { localDeviceId } = await chrome.storage.local.get('localDeviceId');
  if (localDeviceId) return localDeviceId;
  const created = crypto.randomUUID();
  await chrome.storage.local.set({ localDeviceId: created });
  return created;
}

export async function queueDeletion(uid, cloudId) {
  return queueDeletions(uid, [cloudId]);
}

export async function queueDeletions(uid, cloudIds) {
  if (!uid || !cloudIds.length) return;
  const { pendingDeletes = {} } = await chrome.storage.local.get('pendingDeletes');
  pendingDeletes[uid] = [...new Set([...(pendingDeletes[uid] || []),
    ...cloudIds.filter(Boolean)])];
  await chrome.storage.local.set({ pendingDeletes });
}

export function combineVisits(local, remote, uid, deleted = []) {
  const removed = new Set(deleted);
  const rows = new Map();
  for (const visit of local) {
    if (visit.accountUid === uid && !removed.has(visit.cloudId)) {
      rows.set(visit.cloudId, visit);
    }
  }
  for (const visit of remote) {
    if (visit.accountUid !== uid || removed.has(visit.cloudId)) continue;
    const earlier = rows.get(visit.cloudId);
    // Local timing can be newer, but a correction from another device wins.
    if (earlier && (earlier.revision || 0) > (earlier.uploadedRevision || 0)) {
      rows.set(visit.cloudId, withNewerLabels(earlier, visit));
    } else rows.set(visit.cloudId, visit);
  }
  return [...rows.values()].sort((a, b) => b.visitedAt - a.visitedAt);
}

function withNewerLabels(local, remote) {
  if ((remote.labelUpdatedAt || 0) <= (local.labelUpdatedAt || 0)) return local;
  return {
    ...local, purpose: remote.purpose, topic: remote.topic,
    labelSource: remote.labelSource, labelUpdatedAt: remote.labelUpdatedAt
  };
}

async function performSync(session) {
  const { pendingDeletes = {} } = await chrome.storage.local.get('pendingDeletes');
  const localDeletions = pendingDeletes[session.uid] || [];
  const cloudDeletions = new Set(await listCloudDeletions(session));
  for (const cloudId of localDeletions) {
    if (!cloudDeletions.has(cloudId)) await writeCloudDeletion(session, cloudId);
    await deleteCloudVisit(session, cloudId);
    cloudDeletions.add(cloudId);
  }
  if (localDeletions.length) {
    const updated = (await chrome.storage.local.get('pendingDeletes')).pendingDeletes || {};
    updated[session.uid] = (updated[session.uid] || [])
      .filter(id => !localDeletions.includes(id));
    await chrome.storage.local.set({ pendingDeletes: updated });
  }
  const remote = await listCloudVisits(session);
  const remoteById = new Map(remote.map(visit => [visit.cloudId, visit]));
  let uploaded = 0;
  for (const local of await allVisits()) {
    if (local.accountUid !== session.uid || !local.cloudId) continue;
    if (cloudDeletions.has(local.cloudId)) {
      await deleteVisit(local.id);
      const { learnedExamples = [] } = await chrome.storage.local.get('learnedExamples');
      await chrome.storage.local.set({ learnedExamples: learnedExamples.filter(example =>
        example.id !== local.cloudId && example.id !== local.id) });
      continue;
    }
    if ((local.revision || 0) <= (local.uploadedRevision || 0)) continue;
    const outgoing = withNewerLabels(local, remoteById.get(local.cloudId) || {});
    await uploadVisit(session, outgoing);
    if (outgoing.labelUpdatedAt !== local.labelUpdatedAt) {
      await adoptRemoteLabels(local.id, outgoing);
    }
    await markUploaded(local.id, local.revision);
    remoteById.set(local.cloudId, outgoing);
    uploaded++;
  }
  const result = {
    uid: session.uid, email: session.email, uploaded,
    visits: [...remoteById.values()], deletions: [...cloudDeletions],
    syncedAt: Date.now()
  };
  const { syncStatus = {} } = await chrome.storage.local.get('syncStatus');
  syncStatus[session.uid] = { lastSync: result.syncedAt, syncError: '' };
  await chrome.storage.local.set({ syncStatus });
  return result;
}

export async function syncNow() {
  const session = await currentSession();
  if (!session) return { signedOut: true, visits: [], deletions: [] };
  if (running?.uid === session.uid) return running.promise;
  const previous = running?.promise;
  const promise = (previous ? previous.catch(() => {}) : Promise.resolve())
    .then(() => performSync(session)).catch(async error => {
      const { syncStatus = {} } = await chrome.storage.local.get('syncStatus');
      syncStatus[session.uid] = {
        ...syncStatus[session.uid], syncError: error.message
      };
      await chrome.storage.local.set({ syncStatus });
      throw error;
    }).finally(() => {
      if (running?.promise === promise) running = null;
    });
  running = { uid: session.uid, promise };
  return promise;
}
