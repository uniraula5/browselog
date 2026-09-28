import { makeVisit, saveVisit, recentVisits } from './storage.js';

let pending = Promise.resolve();
let saveError = '';

// Finish earlier visits before confirming pause, so they cannot appear afterward.
function enqueue(work) {
  const result = pending.then(work);
  pending = result.catch(() => {});
  return result;
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== 'complete') return;
  const visit = makeVisit(tab);
  if (!visit) return;
  enqueue(async () => {
    const { paused = false } = await chrome.storage.local.get('paused');
    if (!paused) {
      await saveVisit(visit);
      saveError = '';
    }
  }).catch(error => {
    saveError = 'A visit could not be saved. Check the extension errors.';
    console.error('Could not save visit', error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.url !== chrome.runtime.getURL('popup.html')) return;
  if (!['history', 'pause'].includes(message.type)) return;
  enqueue(async () => {
    if (message.type === 'pause') {
      if (typeof message.paused !== 'boolean') throw new Error('Invalid pause setting');
      await chrome.storage.local.set({ paused: message.paused });
    }
    const { paused = false } = await chrome.storage.local.get('paused');
    return { paused, visits: await recentVisits(), saveError };
  }).then(reply, () => reply({ error: 'Could not load history or update recording. Try again.' }));
  return true;
});
