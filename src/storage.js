import { parseSearch } from './searches.js';
import { parseVideo } from './videos.js';
import { classifyVisit, PURPOSES, TOPICS } from './labels.js';

export function makeVisit(tab, visitedAt = Date.now()) {
  if (tab.incognito || !tab.url) return null;
  let url;
  try { url = new URL(tab.url); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const search = parseSearch(tab.url);
  const video = parseVideo(tab.url);
  // Strip credentials, queries, and fragments before anything reaches disk.
  url.username = url.password = url.search = url.hash = '';
  url.pathname = url.pathname.slice(0, 2000);
  const visit = {
    url: url.href, site: url.hostname, title: tab.title?.trim() || 'Untitled page',
    tabId: tab.id, visitedAt, timingVersion: 2
  };
  if (search) {
    visit.searchEngine = search.engine;
    visit.searchQuery = search.query;
  }
  if (video) {
    visit.videoId = video.id;
    visit.videoFormat = video.format;
  }
  return visit;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('browselog', 1);
    request.onupgradeneeded = () => {
      const visits = request.result.createObjectStore('visits', { keyPath: 'id', autoIncrement: true });
      visits.createIndex('visitedAt', 'visitedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveVisit(visit) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite');
      const request = transaction.objectStore('visits').add({
        ...visit, revision: 1, uploadedRevision: 0, updatedAt: Date.now()
      });
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function addActiveTime(id, milliseconds) {
  if (milliseconds <= 0) return;
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite');
      const visits = transaction.objectStore('visits');
      const request = visits.get(id);
      request.onsuccess = () => {
        if (!request.result) return;
        const visit = request.result;
        visit.activeMs = (visit.activeMs || 0) + milliseconds;
        visit.revision = (visit.revision || 0) + 1;
        visit.updatedAt = Date.now();
        visits.put(visit);
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function updateVisitTitle(id, title, rules = [], examples = []) {
  const cleanTitle = title?.trim().slice(0, 500);
  if (!cleanTitle) return;
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite');
      const visits = transaction.objectStore('visits');
      const request = visits.get(id);
      request.onsuccess = () => {
        if (!request.result || request.result.title === cleanTitle) return;
        const updated = { ...request.result, title: cleanTitle };
        if (updated.labelSource !== 'manual') {
          delete updated.learnedFrom;
          Object.assign(updated, classifyVisit(updated, rules, examples));
        }
        updated.revision = (updated.revision || 0) + 1;
        updated.updatedAt = Date.now();
        visits.put(updated);
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function setVisitLabels(id, purpose, topic) {
  if (!PURPOSES.includes(purpose) || !TOPICS.includes(topic)) {
    throw new Error('Invalid labels');
  }
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      let updated = false;
      const transaction = db.transaction('visits', 'readwrite');
      const visits = transaction.objectStore('visits');
      const request = visits.get(id);
      request.onsuccess = () => {
        if (!request.result) return;
        const updatedVisit = {
          ...request.result, purpose, topic, labelSource: 'manual',
          labelUpdatedAt: Date.now(), updatedAt: Date.now(),
          revision: (request.result.revision || 0) + 1
        };
        delete updatedVisit.learnedFrom;
        visits.put(updatedVisit);
        updated = true;
      };
      transaction.oncomplete = () => resolve(updated);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function addPlaybackTime(id, milliseconds, overlapsActive) {
  if (milliseconds <= 0) return;
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite');
      const visits = transaction.objectStore('visits');
      const request = visits.get(id);
      request.onsuccess = () => {
        if (!request.result?.videoId) return;
        const visit = request.result;
        visit.playbackMs = (visit.playbackMs || 0) + milliseconds;
        if (overlapsActive) visit.overlapMs = (visit.overlapMs || 0) + milliseconds;
        visit.revision = (visit.revision || 0) + 1;
        visit.updatedAt = Date.now();
        visits.put(visit);
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

async function recentRows(kind, accountUid) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const rows = [];
      const transaction = db.transaction('visits');
      const cursor = transaction.objectStore('visits').index('visitedAt').openCursor(null, 'prev');
      cursor.onsuccess = () => {
        if (!cursor.result || rows.length === 10) return;
        const visit = cursor.result.value;
        if ((accountUid === undefined || visit.accountUid === accountUid) &&
            (kind === 'all' || (kind === 'search' && visit.searchQuery) ||
            (kind === 'video' && visit.videoId))) rows.push(visit);
        cursor.result.continue();
      };
      transaction.oncomplete = () => resolve(rows);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export const recentVisits = accountUid => recentRows('all', accountUid);
export const recentSearches = accountUid => recentRows('search', accountUid);
export const recentVideos = accountUid => recentRows('video', accountUid);

export async function allVisits() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const rows = [];
      const transaction = db.transaction('visits');
      const cursor = transaction.objectStore('visits').index('visitedAt').openCursor(null, 'prev');
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        rows.push(cursor.result.value);
        cursor.result.continue();
      };
      transaction.oncomplete = () => resolve(rows);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function markUploaded(id, revision) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite');
      const store = transaction.objectStore('visits');
      const request = store.get(id);
      request.onsuccess = () => {
        const visit = request.result;
        if (visit && visit.revision === revision) {
          visit.uploadedRevision = revision;
          store.put(visit);
        }
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function adoptRemoteLabels(id, remote) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite');
      const store = transaction.objectStore('visits');
      const request = store.get(id);
      request.onsuccess = () => {
        const visit = request.result;
        if (!visit || (visit.labelUpdatedAt || 0) >= (remote.labelUpdatedAt || 0)) return;
        Object.assign(visit, {
          purpose: remote.purpose, topic: remote.topic,
          labelSource: remote.labelSource, labelUpdatedAt: remote.labelUpdatedAt
        });
        store.put(visit);
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function assignLegacyVisits(uid, deviceId) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      let changed = 0;
      const transaction = db.transaction('visits', 'readwrite');
      const store = transaction.objectStore('visits');
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        const visit = cursor.result.value;
        if (!visit.accountUid) {
          visit.accountUid = uid;
          visit.deviceId = deviceId;
          visit.cloudId = `${deviceId}-${visit.id}`;
          visit.revision = (visit.revision || 0) + 1;
          visit.uploadedRevision = 0;
          visit.updatedAt = Date.now();
          cursor.result.update(visit);
          changed++;
        }
        cursor.result.continue();
      };
      transaction.oncomplete = () => resolve(changed);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function deleteVisit(id) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite');
      transaction.objectStore('visits').delete(id);
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function clearVisits() {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite');
      transaction.objectStore('visits').clear();
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function clearAccountVisits(uid) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite');
      const cursor = transaction.objectStore('visits').openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        if (cursor.result.value.accountUid === uid) cursor.result.delete();
        cursor.result.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function importArchiveVisits(rows, uid, deviceId) {
  if (!Array.isArray(rows) || rows.length > 10000 || !uid || !deviceId) {
    throw new Error('Archive or account is not ready.');
  }
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      let count = 0;
      const transaction = db.transaction('visits', 'readwrite');
      const store = transaction.objectStore('visits');
      for (const row of rows) {
        if (!row || typeof row.url !== 'string' ||
            !Number.isFinite(row.visitedAt) || row.visitedAt < 0) continue;
        let url;
        try { url = new URL(row.url); } catch { continue; }
        if (!['http:', 'https:'].includes(url.protocol)) continue;
        url.username = url.password = url.search = url.hash = '';
        url.pathname = url.pathname.slice(0, 2000);
        const visit = {
          url: url.href, site: url.hostname,
          title: String(row.title || 'Untitled page').slice(0, 500),
          visitedAt: row.visitedAt, timingVersion: row.timingVersion || 2,
          accountUid: uid, deviceId, cloudId: `${deviceId}-${crypto.randomUUID()}`,
          revision: 1, uploadedRevision: 0, updatedAt: Date.now()
        };
        for (const name of ['activeMs', 'playbackMs', 'overlapMs', 'focusedMs']) {
          if (Number.isFinite(row[name]) && row[name] >= 0) visit[name] = row[name];
        }
        for (const name of ['searchEngine', 'searchQuery', 'videoId', 'videoFormat',
          'format', 'purpose', 'topic', 'labelSource']) {
          if (typeof row[name] === 'string') visit[name] = row[name].slice(0, 500);
        }
        if (Number.isFinite(row.labelUpdatedAt)) visit.labelUpdatedAt = row.labelUpdatedAt;
        store.add(visit);
        count++;
      }
      transaction.oncomplete = () => resolve(count);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
