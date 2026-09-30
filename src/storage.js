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
      const request = transaction.objectStore('visits').add(visit);
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
        visits.put(visit);
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function updateVisitTitle(id, title, rules = []) {
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
          Object.assign(updated, classifyVisit(updated, rules));
        }
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
        visits.put({
          ...request.result, purpose, topic, labelSource: 'manual'
        });
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
        visits.put(visit);
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

async function recentRows(kind) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const rows = [];
      const transaction = db.transaction('visits');
      const cursor = transaction.objectStore('visits').index('visitedAt').openCursor(null, 'prev');
      cursor.onsuccess = () => {
        if (!cursor.result || rows.length === 10) return;
        const visit = cursor.result.value;
        if (kind === 'all' || (kind === 'search' && visit.searchQuery) ||
            (kind === 'video' && visit.videoId)) rows.push(visit);
        cursor.result.continue();
      };
      transaction.oncomplete = () => resolve(rows);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export const recentVisits = () => recentRows('all');
export const recentSearches = () => recentRows('search');
export const recentVideos = () => recentRows('video');

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
