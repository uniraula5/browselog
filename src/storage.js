export function makeVisit(tab, visitedAt = Date.now()) {
  if (tab.incognito || !tab.url) return null;
  let url;
  try { url = new URL(tab.url); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  // Strip credentials, queries, and fragments before anything reaches disk.
  url.username = url.password = url.search = url.hash = '';
  return {
    url: url.href, site: url.hostname, title: tab.title?.trim() || 'Untitled page',
    tabId: tab.id, visitedAt
  };
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
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite');
      transaction.objectStore('visits').add(visit);
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function recentVisits() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const rows = [];
      const transaction = db.transaction('visits');
      const cursor = transaction.objectStore('visits').index('visitedAt').openCursor(null, 'prev');
      cursor.onsuccess = () => {
        if (!cursor.result || rows.length === 10) return;
        rows.push(cursor.result.value);
        cursor.result.continue();
      };
      transaction.oncomplete = () => resolve(rows);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
