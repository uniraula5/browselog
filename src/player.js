// Report short playback intervals. The worker decides whether the tab is visible.
let lastCheck = performance.now();

setInterval(() => {
  const now = performance.now();
  const milliseconds = Math.min(1200, now - lastCheck);
  lastCheck = now;
  if (document.visibilityState !== 'visible' || milliseconds <= 0) return;
  const videos = document.querySelectorAll('video');
  const playing = [...videos].some(video =>
    !video.paused && !video.ended && video.readyState >= 2);
  if (!playing) return;
  chrome.runtime.sendMessage({
    type: 'playback', url: location.href, milliseconds
  }).catch(() => {});
}, 1000);
