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
const searches = document.getElementById('searches');
const videos = document.getElementById('videos');
const idleSeconds = document.getElementById('idle-seconds');
const accountStatus = document.getElementById('account-status');
const signIn = document.getElementById('sign-in');
let paused = false;

async function loadAccount() {
  const account = await chrome.runtime.sendMessage({ type: 'account' });
  if (account?.error) throw new Error(account.error);
  if (!account?.configured) {
    accountStatus.textContent = 'Local build. Set up cloud sync to sign in.';
    signIn.hidden = true;
  } else if (account.signedIn) {
    accountStatus.textContent = `${account.email || 'Google account'} · sync ${account.syncError ? 'needs retry' : 'ready'}`;
    signIn.hidden = true;
  } else {
    accountStatus.textContent = 'Sign in to start recording and sync across devices.';
    signIn.hidden = false;
  }
  return account;
}

signIn.addEventListener('click', async () => {
  signIn.disabled = true;
  accountStatus.textContent = 'Opening Google sign-in…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'signIn' });
    if (!result?.ok) throw new Error(result?.error || 'Sign-in failed.');
    await loadAccount();
    await loadHistory();
  } catch (error) {
    accountStatus.textContent = error.message;
  } finally { signIn.disabled = false; }
});

function timeLabel(milliseconds) {
  const seconds = Math.floor((milliseconds || 0) / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

async function loadHistory(message = { type: 'history' }) {
  pause.disabled = true;
  idleSeconds.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result || result.error) throw new Error(result?.error || 'History is unavailable.');
    const account = await loadAccount();
    paused = result.paused;
    idleSeconds.value = String(result.idleSeconds);
    pause.textContent = paused ? 'Resume recording' : 'Pause recording';
    recordingStatus.textContent = account.configured && !account.signedIn
      ? 'Sign in to start recording.' : result.saveError || (paused ? 'Recording paused.' :
      result.idleState === 'active' ? 'Recording active browsing.' : 'Idle or locked. Time paused.');
    visits.replaceChildren();
    for (const visit of result.visits) {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      const detail = document.createElement('span');
      const timing = document.createElement('span');
      const labels = document.createElement('span');
      name.textContent = visit.title;
      detail.textContent = `${visit.site} · ${new Date(visit.visitedAt).toLocaleString()}`;
      const older = visit.timingVersion !== 2;
      timing.textContent = `${older ? 'Focused (earlier version)' : 'Active estimate'}: ${timeLabel(older ? visit.focusedMs : visit.activeMs)}`;
      labels.textContent = `${visit.purpose || 'unknown'} · ${visit.topic || 'unknown'}`;
      item.append(name, detail, timing, labels);
      visits.append(item);
    }
    if (!result.visits.length) visits.textContent = 'No visits yet. Open or reload a website.';
    searches.replaceChildren();
    for (const search of result.searches) {
      const item = document.createElement('li');
      const query = document.createElement('strong');
      const detail = document.createElement('span');
      query.textContent = search.searchQuery;
      detail.textContent = `${search.searchEngine} · ${new Date(search.visitedAt).toLocaleString()}`;
      item.append(query, detail);
      searches.append(item);
    }
    if (!result.searches.length) searches.textContent = 'No supported searches yet.';
    videos.replaceChildren();
    for (const video of result.videos) {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      const detail = document.createElement('span');
      const timing = document.createElement('span');
      const playback = document.createElement('span');
      const labels = document.createElement('span');
      name.textContent = video.title;
      detail.textContent = `${video.videoFormat} · ${new Date(video.visitedAt).toLocaleString()}`;
      timing.textContent = `Active estimate: ${timeLabel(video.activeMs)}`;
      playback.textContent = `Playing estimate: ${timeLabel(video.playbackMs)}`;
      labels.textContent = `${video.purpose || 'unknown'} · ${video.topic || 'unknown'}`;
      item.append(name, detail, timing, playback, labels);
      videos.append(item);
    }
    if (!result.videos.length) videos.textContent = 'No videos or Shorts yet.';
    pause.disabled = account.signedIn === false && account.configured;
    idleSeconds.disabled = account.signedIn === false && account.configured;
  } catch (error) {
    recordingStatus.textContent = `${error.message} Use Refresh page details to retry.`;
  }
}

pause.addEventListener('click', () => loadHistory({ type: 'pause', paused: !paused }));
idleSeconds.addEventListener('change', () => loadHistory({ type: 'idleSetting', seconds: Number(idleSeconds.value) }));
refresh.addEventListener('click', () => loadHistory());
document.getElementById('dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
loadHistory();
