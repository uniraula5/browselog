import {
  makeVisit, saveVisit, recentVisits, recentSearches, recentVideos,
  addActiveTime, addPlaybackTime, updateVisitTitle
} from './storage.js';
import { focusedVisit, changeFocus, samePage } from './tracker.js';

let pending = Promise.resolve();
let saveError = '';
const IDLE_OPTIONS = [30, 60, 120, 300];
const DEFAULT_IDLE_SECONDS = 60;
const CHECKPOINT_ALARM = 'browselog-checkpoint';
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
  const { paused = false, idleSeconds = DEFAULT_IDLE_SECONDS } = await chrome.storage.local.get(['paused', 'idleSeconds']);
  const threshold = IDLE_OPTIONS.includes(idleSeconds) ? idleSeconds : DEFAULT_IDLE_SECONDS;
  const idleState = idleOverride || await chrome.idle.queryState(threshold);
  const window = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
  const next = changeFocus(focus, focusedVisit(window, tabVisits, paused, idleState), now, MAX_GAP_MS);
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

async function restoreOpenTabs(now) {
  const { paused = false } = await chrome.storage.local.get('paused');
  if (paused) return;
  const { tabVisits = {} } = await chrome.storage.session.get('tabVisits');
  const windows = await chrome.windows.getAll({ populate: true });
  for (const window of windows) {
    for (const tab of window.tabs || []) {
      if (tab.status !== 'complete' || tab.discarded) continue;
      const visit = makeVisit(tab, now);
      if (!visit || samePage(tabVisits[tab.id], visit)) continue;
      tabVisits[tab.id] = sessionVisit(await saveVisit(visit), visit);
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
});

chrome.tabs.onActivated.addListener(() => refreshFocus());
chrome.windows.onFocusChanged.addListener(() => refreshFocus());
chrome.windows.onBoundsChanged.addListener(() => refreshFocus());
chrome.tabs.onRemoved.addListener(tabId => refreshFocus({ tabId }));
chrome.idle.onStateChanged.addListener(state => refreshFocus(null, state));

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.title && !change.status) {
    enqueue(async () => {
      const { paused = false } = await chrome.storage.local.get('paused');
      if (paused) return;
      const page = makeVisit(tab);
      if (!page?.videoId) return;
      const { tabVisits = {} } = await chrome.storage.session.get('tabVisits');
      const earlier = tabVisits[tabId];
      if (samePage(earlier, page)) await updateVisitTitle(earlier.id, change.title);
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
    const { paused = false } = await chrome.storage.local.get('paused');
    if (!paused && visit) {
      const { tabVisits = {} } = await chrome.storage.session.get('tabVisits');
      const earlier = tabVisits[tabId];
      saved = samePage(earlier, visit) ? earlier :
        sessionVisit(await saveVisit(visit), visit);
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
    const { paused = false } = await chrome.storage.local.get('paused');
    if (paused) return;
    const tab = await chrome.tabs.get(details.tabId).catch(() => null);
    if (!tab) return;
    const visit = makeVisit({ ...tab, url: details.url }, now);
    if (!visit?.searchQuery && !visit?.videoId) return;
    const { tabVisits = {} } = await chrome.storage.session.get('tabVisits');
    const earlier = tabVisits[details.tabId];
    if (samePage(earlier, visit)) return;
    // A same-page video switch may still have the previous video's title.
    if (visit.videoId) visit.title = `${visit.videoFormat} on YouTube`;
    const saved = sessionVisit(await saveVisit(visit), visit);
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
      const { paused = false, idleSeconds = DEFAULT_IDLE_SECONDS } =
        await chrome.storage.local.get(['paused', 'idleSeconds']);
      if (paused) return false;
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
  if (sender.url !== chrome.runtime.getURL('popup.html')) return;
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
    const { paused = false } = await chrome.storage.local.get('paused');
    return {
      paused, idleState, idleSeconds: threshold,
      visits: await recentVisits(), searches: await recentSearches(),
      videos: await recentVideos(), saveError
    };
  }).then(reply, () => reply({ error: 'Could not load history or update recording. Try again.' }));
  return true;
});
