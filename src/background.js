import { makeVisit, saveVisit, recentVisits, addFocusedTime } from './storage.js';
import { focusedVisit, changeFocus } from './tracker.js';

let pending = Promise.resolve();
let saveError = '';

// Finish earlier visits before confirming pause, so they cannot appear afterward.
function enqueue(work) {
  const result = pending.then(work);
  pending = result.catch(() => {});
  return result;
}

async function syncFocus(update, now) {
  const { tabVisits = {}, focus = null } = await chrome.storage.session.get(['tabVisits', 'focus']);
  if (update) {
    if (update.visit) tabVisits[update.tabId] = update.visit;
    else delete tabVisits[update.tabId];
  }
  const { paused = false } = await chrome.storage.local.get('paused');
  const window = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
  const next = changeFocus(focus, focusedVisit(window, tabVisits, paused), now);
  // Advance the session first so a failed history write cannot count time twice.
  await chrome.storage.session.set({ tabVisits, focus: next.current });
  if (next.finished) await addFocusedTime(next.finished.visitId, next.finished.milliseconds);
}

function reportError(error) {
  saveError = 'Activity could not be saved. Check the extension errors.';
  console.error('Could not save activity', error);
}

function refreshFocus(update) {
  const now = Date.now();
  enqueue(() => syncFocus(update, now)).catch(reportError);
}

chrome.tabs.onActivated.addListener(() => refreshFocus());
chrome.windows.onFocusChanged.addListener(() => refreshFocus());
chrome.windows.onBoundsChanged.addListener(() => refreshFocus());
chrome.tabs.onRemoved.addListener(tabId => refreshFocus({ tabId }));

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!['loading', 'complete'].includes(change.status)) return;
  const now = Date.now();
  enqueue(async () => {
    let saved = null;
    const visit = change.status === 'complete' ? makeVisit(tab, now) : null;
    const { paused = false } = await chrome.storage.local.get('paused');
    if (!paused && visit) {
      saved = { id: await saveVisit(visit), url: visit.url };
      saveError = '';
    }
    await syncFocus({ tabId, visit: saved }, now);
  }).catch(reportError);
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.url !== chrome.runtime.getURL('popup.html')) return;
  if (!['history', 'pause'].includes(message.type)) return;
  const now = Date.now();
  enqueue(async () => {
    if (message.type === 'pause') {
      if (typeof message.paused !== 'boolean') throw new Error('Invalid pause setting');
      await chrome.storage.local.set({ paused: message.paused });
    }
    await syncFocus(null, now);
    const { paused = false } = await chrome.storage.local.get('paused');
    return { paused, visits: await recentVisits(), saveError };
  }).then(reply, () => reply({ error: 'Could not load history or update recording. Try again.' }));
  return true;
});
