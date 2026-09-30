import { makeVisit } from './storage.js';

export function samePage(recorded, page) {
  if (!recorded || !page) return false;
  return recorded.url === page.url &&
    recorded.searchQuery === page.searchQuery &&
    recorded.videoId === page.videoId &&
    recorded.videoFormat === page.videoFormat;
}

export function focusedVisit(window, tabVisits, paused, idleState = 'active') {
  if (paused || idleState !== 'active' || !window?.focused || window.state === 'minimized') return null;
  const tab = window?.tabs?.find(item => item.active);
  if (!tab || tab.status !== 'complete' || tab.discarded) return null;
  const page = makeVisit(tab);
  const visit = tabVisits[tab.id];
  return page && samePage(visit, page) ? visit.id : null;
}

export function changeFocus(current, visitId, now, maxGapMs = Infinity) {
  // Each update closes the old interval and starts a fresh one at the same time.
  return {
    finished: current ? {
      visitId: current.visitId,
      milliseconds: Math.min(maxGapMs, Math.max(0, now - current.startedAt))
    } : null,
    current: visitId === null ? null : { visitId, startedAt: now }
  };
}
