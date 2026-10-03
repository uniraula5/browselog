import {
  makeVisit, saveVisit, recentVisits, recentSearches, recentVideos,
  addActiveTime, addPlaybackTime, updateVisitTitle, deleteVisit, clearVisits,
  clearAccountVisits
} from './storage.js';
import { focusedVisit, changeFocus, samePage } from './tracker.js';
import { classifyVisit } from './labels.js';
import { removeExample } from './learning.js';
import { isExcluded } from './settings.js';
import {
  configured, currentSession, listCloudVisits, signInWithGoogle, signOut, uploadVisit
} from './cloud.js';
import { adoptRemoteLabels, assignLegacyVisits, allVisits } from './storage.js';
import { deviceId, queueDeletion, queueDeletions, syncNow } from './sync.js';
import { PURPOSES, TOPICS } from './labels.js';

let pending = Promise.resolve();
let saveError = '';
const IDLE_OPTIONS = [30, 60, 120, 300];
const DEFAULT_IDLE_SECONDS = 60;
const CHECKPOINT_ALARM = 'browselog-checkpoint';
const SYNC_ALARM = 'browselog-sync';
// A delayed alarm after sleep should never credit the entire sleep period.
const MAX_GAP_MS = 60_000;

// This must run when the worker starts because the worker can be stopped by Chrome.
chrome.storage.local.get('idleSeconds').then(({ idleSeconds }) => {
  chrome.idle.setDetectionInterval(IDLE_OPTIONS.includes(idleSeconds) ? idleSeconds : DEFAULT_IDLE_SECONDS);
}).catch(error => console.error('Could not set idle threshold', error));

// Alarms can disappear after a browser restart, so check each time the worker starts.
chrome.alarms.get(CHECKPOINT_ALARM).then(alarm => {
  if (!alarm) return chrome.alarms.create(CHECKPOINT_ALARM, { periodInMinutes: 0.5 });
}).catch(error => console.error('Could not schedule checkpoints', error));
chrome.alarms.get(SYNC_ALARM).then(alarm => {
  if (!alarm) return chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 2 });
}).catch(error => console.error('Could not schedule sync', error));

// Finish earlier visits before confirming pause, so they cannot appear afterward.
function enqueue(work) {
  const result = pending.then(work);
  pending = result.catch(() => {});
  return result;
}

async function syncFocus(update, now, idleOverride) {
  const { tabVisits = {}, focus = null } = await chrome.storage.session.get(['tabVisits', 'focus']);
  if (update) {
    if (update.visit) tabVisits[update.tabId] = update.visit;
    else delete tabVisits[update.tabId];
  }
  const { paused = false, idleSeconds = DEFAULT_IDLE_SECONDS, excludedSites = [], authSession } =
    await chrome.storage.local.get(['paused', 'idleSeconds', 'excludedSites', 'authSession']);
  const threshold = IDLE_OPTIONS.includes(idleSeconds) ? idleSeconds : DEFAULT_IDLE_SECONDS;
  const idleState = idleOverride || await chrome.idle.queryState(threshold);
  const window = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
  const selected = window?.tabs?.find(tab => tab.active);
  const selectedSite = selected ? makeVisit(selected)?.site : null;
  const excluded = selectedSite && isExcluded(selectedSite, excludedSites);
  const visitId = excluded || (configured() && !authSession?.uid)
    ? null : focusedVisit(window, tabVisits, paused, idleState);
  const next = changeFocus(focus, visitId, now, MAX_GAP_MS);
  // Advance the session first so a failed history write cannot count time twice.
  await chrome.storage.session.set({ tabVisits, focus: next.current });
  if (next.finished) await addActiveTime(next.finished.visitId, next.finished.milliseconds);
  return { idleState, threshold };
}

function reportError(error) {
  saveError = 'Activity could not be saved. Check the extension errors.';
  console.error('Could not save activity', error);
}

function refreshFocus(update, idleState) {
  const now = Date.now();
  enqueue(() => syncFocus(update, now, idleState)).catch(reportError);
}

function sessionVisit(id, visit) {
  return {
    id, url: visit.url, searchQuery: visit.searchQuery,
    videoId: visit.videoId, videoFormat: visit.videoFormat
  };
}

async function recordVisit(visit) {
  const { rules = [], excludedSites = [], learnedExamples = [], authSession } =
    await chrome.storage.local.get(['rules', 'excludedSites', 'learnedExamples', 'authSession']);
  if (isExcluded(visit.site, excludedSites)) return null;
  if (configured() && !authSession?.uid) return null;
  const localDeviceId = authSession?.uid ? await deviceId() : null;
  const account = authSession?.uid ? {
    accountUid: authSession.uid,
    deviceId: localDeviceId,
    cloudId: `${localDeviceId}-${crypto.randomUUID()}`
  } : {};
  const labeledVisit = { ...visit, ...account };
  return saveVisit({ ...labeledVisit,
    ...classifyVisit(labeledVisit, rules, learnedExamples) });
}

async function restoreOpenTabs(now) {
  const { paused = false, authSession } = await chrome.storage.local.get(['paused', 'authSession']);
  if (paused || (configured() && !authSession?.uid)) return;
  const { tabVisits = {} } = await chrome.storage.session.get('tabVisits');
  const windows = await chrome.windows.getAll({ populate: true });
  for (const window of windows) {
    for (const tab of window.tabs || []) {
      if (tab.status !== 'complete' || tab.discarded) continue;
      const visit = makeVisit(tab, now);
      if (!visit || samePage(tabVisits[tab.id], visit)) continue;
      const id = await recordVisit(visit);
      if (id) tabVisits[tab.id] = sessionVisit(id, visit);
    }
  }
  await chrome.storage.session.set({ tabVisits });
  await syncFocus(null, now);
}

chrome.runtime.onStartup.addListener(() => {
  enqueue(() => restoreOpenTabs(Date.now())).catch(reportError);
});
chrome.runtime.onInstalled.addListener(({ reason }) => {
  enqueue(async () => {
    if (reason === 'update') await chrome.storage.session.remove(['tabVisits', 'focus']);
    await restoreOpenTabs(Date.now());
  }).catch(reportError);
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === CHECKPOINT_ALARM) refreshFocus();
  if (alarm.name === SYNC_ALARM && configured()) syncNow().catch(console.error);
});

chrome.tabs.onActivated.addListener(() => refreshFocus());
chrome.windows.onFocusChanged.addListener(() => refreshFocus());
chrome.windows.onBoundsChanged.addListener(() => refreshFocus());
chrome.tabs.onRemoved.addListener(tabId => refreshFocus({ tabId }));
chrome.idle.onStateChanged.addListener(state => refreshFocus(null, state));

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.title && !change.status) {
    enqueue(async () => {
      const { paused = false, authSession } = await chrome.storage.local.get(['paused', 'authSession']);
      if (paused || (configured() && !authSession?.uid)) return;
      const page = makeVisit(tab);
      if (!page?.videoId) return;
      const { tabVisits = {} } = await chrome.storage.session.get('tabVisits');
      const earlier = tabVisits[tabId];
      if (samePage(earlier, page)) {
        const { rules = [], learnedExamples = [] } =
          await chrome.storage.local.get(['rules', 'learnedExamples']);
        await updateVisitTitle(earlier.id, change.title, rules, learnedExamples);
      }
    }).catch(reportError);
  }
  if (!['loading', 'complete'].includes(change.status)) return;
  const now = Date.now();
  enqueue(async () => {
    // Keep the last visit until onCommitted confirms a full navigation.
    // History API searches also report loading, but keep the same document.
    if (change.status === 'loading') return syncFocus(null, now);
    let saved = null;
    const visit = makeVisit(tab, now);
    const { paused = false, authSession } = await chrome.storage.local.get(['paused', 'authSession']);
    if (!paused && (!configured() || authSession?.uid) && visit) {
      const { tabVisits = {} } = await chrome.storage.session.get('tabVisits');
      const earlier = tabVisits[tabId];
      if (samePage(earlier, visit)) saved = earlier;
      else {
        const id = await recordVisit(visit);
        if (id) saved = sessionVisit(id, visit);
      }
      saveError = '';
    }
    await syncFocus({ tabId, visit: saved }, now);
  }).catch(reportError);
});

chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId === 0) refreshFocus({ tabId: details.tabId });
});

// YouTube can change searches and videos without a page load.
chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId !== 0) return;
  const now = Date.now();
  enqueue(async () => {
    const { paused = false, authSession } = await chrome.storage.local.get(['paused', 'authSession']);
    if (paused || (configured() && !authSession?.uid)) return;
    const tab = await chrome.tabs.get(details.tabId).catch(() => null);
    if (!tab) return;
    const visit = makeVisit({ ...tab, url: details.url }, now);
    if (!visit?.searchQuery && !visit?.videoId) return;
    const { tabVisits = {} } = await chrome.storage.session.get('tabVisits');
    const earlier = tabVisits[details.tabId];
    if (samePage(earlier, visit)) return;
    // A same-page video switch may still have the previous video's title.
    if (visit.videoId) visit.title = `${visit.videoFormat} on YouTube`;
    const id = await recordVisit(visit);
    const saved = id ? sessionVisit(id, visit) : null;
    await syncFocus({ tabId: details.tabId, visit: saved }, now);
    saveError = '';
  }).catch(reportError);
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === 'playback' && sender.tab && sender.frameId === 0) {
    const now = Date.now();
    enqueue(async () => {
      if (!Number.isFinite(message.milliseconds) || message.milliseconds <= 0) return false;
      const reported = makeVisit({ url: message.url, id: sender.tab.id });
      if (!reported?.videoId) return false;
      const { paused = false, idleSeconds = DEFAULT_IDLE_SECONDS, excludedSites = [], authSession } =
        await chrome.storage.local.get(['paused', 'idleSeconds', 'excludedSites', 'authSession']);
      if (paused || (configured() && !authSession?.uid) ||
          isExcluded(reported.site, excludedSites)) return false;
      const window = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
      const tab = window?.tabs?.find(item => item.active && item.id === sender.tab.id);
      if (!window?.focused || window.state === 'minimized' || !tab || tab.discarded) return false;
      const page = makeVisit(tab, now);
      if (!page?.videoId || !samePage(page, reported)) return false;
      const { tabVisits = {} } = await chrome.storage.session.get('tabVisits');
      const saved = tabVisits[tab.id];
      if (!samePage(saved, page)) return false;
      const threshold = IDLE_OPTIONS.includes(idleSeconds) ? idleSeconds : DEFAULT_IDLE_SECONDS;
      const idleState = await chrome.idle.queryState(threshold);
      if (idleState === 'locked') return false;
      await addPlaybackTime(saved.id, Math.min(message.milliseconds, 1200), idleState === 'active');
      return true;
    }).then(reply, () => reply(false));
    return true;
  }
  const dashboard = sender.url === chrome.runtime.getURL('dashboard.html');
  if (![chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('dashboard.html')]
    .includes(sender.url)) return;
  if (['account', 'signIn', 'signOut', 'sync', 'cloudHistory', 'importOlder'].includes(message.type)) {
    (async () => {
      if (message.type === 'signIn') {
        const { authSession: previous } = await chrome.storage.local.get('authSession');
        const user = await signInWithGoogle();
        if (previous?.uid !== user.uid) {
          await chrome.storage.session.remove(['tabVisits', 'focus']);
        }
        await deviceId();
        await enqueue(() => restoreOpenTabs(Date.now()));
        syncNow().catch(console.error);
        return { ok: true, user };
      }
      if (message.type === 'signOut') {
        await enqueue(() => syncFocus(null, Date.now()));
        await signOut();
        await chrome.storage.session.remove(['tabVisits', 'focus']);
        return { ok: true };
      }
      const { authSession, syncStatus = {} } = await chrome.storage.local.get(
        ['authSession', 'syncStatus']);
      if (message.type === 'account') return {
        configured: configured(), signedIn: Boolean(authSession?.uid),
        email: authSession?.email, uid: authSession?.uid,
        ...syncStatus[authSession?.uid]
      };
      if (!authSession?.uid) throw new Error('Sign in to use cloud sync.');
      if (message.type === 'importOlder') {
        const count = await assignLegacyVisits(authSession.uid, await deviceId());
        await syncNow();
        return { ok: true, count };
      }
      const result = await syncNow();
      return message.type === 'cloudHistory' ? result : {
        ok: true, uploaded: result.uploaded, syncedAt: result.syncedAt
      };
    })().then(reply, error => reply({ error: error.message }));
    return true;
  }
  if (dashboard && message.type === 'deleteSyncedVisit') {
    enqueue(async () => {
      const { authSession } = await chrome.storage.local.get('authSession');
      if (!authSession?.uid || !/^[a-zA-Z0-9-]{1,100}$/.test(message.cloudId)) {
        throw new Error('Invalid cloud visit.');
      }
      await queueDeletion(authSession.uid, message.cloudId);
      const local = (await allVisits()).find(visit =>
        visit.accountUid === authSession.uid && visit.cloudId === message.cloudId);
      if (local) await deleteVisit(local.id);
      const { learnedExamples = [] } = await chrome.storage.local.get('learnedExamples');
      await chrome.storage.local.set({ learnedExamples: learnedExamples.filter(example =>
        example.id !== message.cloudId && example.id !== local?.id) });
      return { ok: true };
    }).then(async result => {
      syncNow().catch(console.error);
      reply(result);
    }, error => reply({ error: error.message }));
    return true;
  }
  if (dashboard && message.type === 'correctCloudVisit') {
    (async () => {
      if (!PURPOSES.includes(message.purpose) || !TOPICS.includes(message.topic) ||
          !/^[a-zA-Z0-9-]{1,100}$/.test(message.cloudId)) {
        throw new Error('Invalid cloud correction.');
      }
      await syncNow();
      const session = await currentSession();
      if (!session) throw new Error('Sign in to correct this visit.');
      const visit = (await listCloudVisits(session))
        .find(item => item.cloudId === message.cloudId);
      if (!visit) throw new Error('Visit is no longer in the cloud.');
      const updated = {
        ...visit, purpose: message.purpose, topic: message.topic,
        labelSource: 'manual', labelUpdatedAt: Date.now()
      };
      await uploadVisit(session, updated);
      const local = (await allVisits()).find(item => item.cloudId === message.cloudId &&
        item.accountUid === session.uid);
      if (local) await adoptRemoteLabels(local.id, updated);
      return { ok: true };
    })().then(reply, error => reply({ error: error.message }));
    return true;
  }
  if (dashboard && ['deleteVisit', 'clearHistory'].includes(message.type)) {
    const now = Date.now();
    enqueue(async () => {
      await syncFocus(null, now);
      if (message.type === 'deleteVisit') {
        if (!Number.isInteger(message.id) || message.id < 1) throw new Error('Invalid visit ID');
        const { authSession } = await chrome.storage.local.get('authSession');
        const saved = (await allVisits()).find(visit => visit.id === message.id);
        if (!saved || (configured() && saved.accountUid !== authSession?.uid)) {
          throw new Error('Visit is not in this account.');
        }
        if (configured() && saved.cloudId) await queueDeletion(authSession.uid, saved.cloudId);
        await deleteVisit(message.id);
        const { learnedExamples = [] } = await chrome.storage.local.get('learnedExamples');
        await chrome.storage.local.set({
          learnedExamples: removeExample(learnedExamples, message.id)
        });
        const { tabVisits = {}, focus = null } = await chrome.storage.session.get(['tabVisits', 'focus']);
        for (const [tabId, visit] of Object.entries(tabVisits)) {
          if (visit.id === message.id) delete tabVisits[tabId];
        }
        await chrome.storage.session.set({
          tabVisits, focus: focus?.visitId === message.id ? null : focus
        });
      } else {
        const { authSession } = await chrome.storage.local.get('authSession');
        if (configured() && authSession?.uid) {
          const session = await currentSession();
          const remote = await listCloudVisits(session);
          const local = (await allVisits()).filter(visit => visit.accountUid === session.uid);
          await queueDeletions(session.uid,
            [...remote, ...local].map(visit => visit.cloudId));
        }
        if (configured() && authSession?.uid) {
          await clearAccountVisits(authSession.uid);
          const { learnedExamples = [] } = await chrome.storage.local.get('learnedExamples');
          await chrome.storage.local.set({ learnedExamples:
            learnedExamples.filter(example => example.accountUid !== authSession.uid) });
        } else {
          await clearVisits();
          await chrome.storage.local.remove('learnedExamples');
        }
        await chrome.storage.session.remove(['tabVisits', 'focus']);
      }
      if (configured()) syncNow().catch(console.error);
      return { ok: true };
    }).then(reply, () => reply({ error: 'Could not delete history.' }));
    return true;
  }
  if (!['history', 'pause', 'idleSetting'].includes(message.type)) return;
  const now = Date.now();
  enqueue(async () => {
    if (message.type === 'pause') {
      if (typeof message.paused !== 'boolean') throw new Error('Invalid pause setting');
      await chrome.storage.local.set({ paused: message.paused });
      if (!message.paused) await restoreOpenTabs(now);
    }
    if (message.type === 'idleSetting') {
      if (!IDLE_OPTIONS.includes(message.seconds)) throw new Error('Invalid idle threshold');
      await chrome.storage.local.set({ idleSeconds: message.seconds });
      chrome.idle.setDetectionInterval(message.seconds);
    }
    const { idleState, threshold } = await syncFocus(null, now);
    const { paused = false, authSession } = await chrome.storage.local.get(['paused', 'authSession']);
    return {
      paused, idleState, idleSeconds: threshold,
      signedIn: Boolean(authSession?.uid), email: authSession?.email,
      visits: configured() && !authSession?.uid ? [] :
        await recentVisits(configured() ? authSession.uid : undefined),
      searches: configured() && !authSession?.uid ? [] :
        await recentSearches(configured() ? authSession.uid : undefined),
      videos: configured() && !authSession?.uid ? [] :
        await recentVideos(configured() ? authSession.uid : undefined),
      saveError
    };
  }).then(reply, () => reply({ error: 'Could not load history or update recording. Try again.' }));
  return true;
});
