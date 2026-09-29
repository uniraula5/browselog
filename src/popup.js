const site = document.getElementById('page-site');
const title = document.getElementById('page-title');
const refresh = document.getElementById('refresh');

async function showCurrentPage() {
  refresh.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url) {
      site.textContent = 'Page details unavailable';
      title.textContent = 'Open a website, then reopen BrowseLog.';
      return;
    }

    const url = new URL(tab.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      site.textContent = 'Browser or local page';
      title.textContent = 'BrowseLog currently supports ordinary websites.';
      return;
    }

    // Show text only, so a page title cannot insert HTML into the popup.
    site.textContent = url.hostname;
    title.textContent = tab.title?.trim() || 'Untitled page';
  } catch {
    site.textContent = 'Could not read this tab';
    title.textContent = 'Try reopening BrowseLog from the browser toolbar.';
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener('click', showCurrentPage);
showCurrentPage();

const pause = document.getElementById('pause');
const recordingStatus = document.getElementById('recording-status');
const visits = document.getElementById('visits');
const idleSeconds = document.getElementById('idle-seconds');
let paused = false;

async function loadHistory(message = { type: 'history' }) {
  pause.disabled = true;
  idleSeconds.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result || result.error) throw new Error(result?.error || 'History is unavailable.');
    paused = result.paused;
    idleSeconds.value = String(result.idleSeconds);
    pause.textContent = paused ? 'Resume recording' : 'Pause recording';
    recordingStatus.textContent = result.saveError || (paused ? 'Recording paused.' :
      result.idleState === 'active' ? 'Recording active browsing.' : 'Idle or locked. Time paused.');
    visits.replaceChildren();
    for (const visit of result.visits) {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      const detail = document.createElement('span');
      const timing = document.createElement('span');
      name.textContent = visit.title;
      detail.textContent = `${visit.site} · ${new Date(visit.visitedAt).toLocaleString()}`;
      const older = visit.timingVersion !== 2;
      const seconds = Math.floor(((older ? visit.focusedMs : visit.activeMs) || 0) / 1000);
      timing.textContent = `${older ? 'Focused (earlier version)' : 'Active estimate'}: ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
      item.append(name, detail, timing);
      visits.append(item);
    }
    if (!result.visits.length) visits.textContent = 'No visits yet. Open or reload a website.';
    pause.disabled = false;
    idleSeconds.disabled = false;
  } catch (error) {
    recordingStatus.textContent = `${error.message} Use Refresh page details to retry.`;
  }
}

pause.addEventListener('click', () => loadHistory({ type: 'pause', paused: !paused }));
idleSeconds.addEventListener('change', () => loadHistory({ type: 'idleSetting', seconds: Number(idleSeconds.value) }));
refresh.addEventListener('click', () => loadHistory());
loadHistory();
