import { allVisits, importArchiveVisits, setVisitLabels } from './storage.js';
import { PURPOSES, TOPICS } from './labels.js';
import { engagedTime, summarize } from './summary.js';
import { normalizeSite } from './settings.js';
import { makeExample, saveExample } from './learning.js';
import { combineVisits } from './sync.js';

const range = document.getElementById('range');
const formatFilter = document.getElementById('format-filter');
const purposeFilter = document.getElementById('purpose-filter');
const textFilter = document.getElementById('text-filter');
const status = document.getElementById('status');
const timeline = document.getElementById('timeline');
const deviceFilter = document.getElementById('device-filter');
let visits = [];
let localVisits = [];
let rules = [];
let excludedSites = [];
let learnedExamples = [];
let allLearnedExamples = [];
let account = { configured: false, signedIn: false };

function duration(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return `${Math.floor(milliseconds / 1000)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function startOfRange() {
  if (range.value === 'all') return 0;
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  if (range.value === 'week') day.setDate(day.getDate() - 6);
  return day.getTime();
}

function selectedVisits() {
  const start = startOfRange();
  return visits.filter(visit => visit.visitedAt >= start &&
    (deviceFilter.value === 'all' || visit.deviceId === deviceFilter.value));
}

function stat(label, value) {
  const card = document.createElement('div');
  const number = document.createElement('strong');
  const caption = document.createElement('span');
  card.className = 'stat';
  number.textContent = value;
  caption.textContent = label;
  card.append(number, caption);
  return card;
}

function showTotals(rows) {
  const totals = summarize(rows);
  document.getElementById('totals').replaceChildren(
    stat('Engaged estimate', duration(totals.engagedMs)),
    stat('Active browsing', duration(totals.activeMs)),
    stat('Video playing', duration(totals.playbackMs)),
    stat('Visits', String(totals.visits)),
    stat('Searches', String(totals.searches)),
    stat('Shorts', String(totals.shorts))
  );
  for (const name of ['purposes', 'topics', 'formats', 'sites']) {
    showBars(name, totals[name]);
  }
}

function showBars(id, values) {
  const box = document.getElementById(id);
  box.replaceChildren();
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) {
    box.textContent = 'No activity in this period.';
    return;
  }
  const largest = Math.max(...entries.map(([, time]) => time), 1);
  for (const [name, milliseconds] of entries) {
    const row = document.createElement('div');
    const label = document.createElement('div');
    const title = document.createElement('span');
    const time = document.createElement('span');
    const track = document.createElement('div');
    const fill = document.createElement('div');
    row.className = 'bar-row';
    label.className = 'bar-label';
    track.className = 'bar-track';
    fill.className = 'bar-fill';
    title.textContent = name;
    time.textContent = duration(milliseconds);
    fill.style.width = `${100 * milliseconds / largest}%`;
    label.append(title, time);
    track.append(fill);
    row.append(label, track);
    box.append(row);
  }
}

function labelSelect(options, value, name) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', name);
  for (const option of options) {
    const choice = document.createElement('option');
    choice.value = option;
    choice.textContent = option;
    select.append(choice);
  }
  select.value = options.includes(value) ? value : 'unknown';
  return select;
}

function visitRow(visit) {
  const item = document.createElement('li');
  const title = document.createElement('p');
  const meta = document.createElement('p');
  const labels = document.createElement('div');
  const purpose = labelSelect(PURPOSES, visit.purpose, 'Purpose');
  const topic = labelSelect(TOPICS, visit.topic, 'Topic');
  const save = document.createElement('button');
  const remove = document.createElement('button');
  const source = document.createElement('small');
  title.className = 'visit-title';
  meta.className = 'visit-meta';
  labels.className = 'visit-labels';
  title.textContent = visit.title;
  const time = duration(engagedTime(visit));
  const device = visit.deviceId ? ` · ${visit.deviceId === account.deviceId
    ? 'This device' : `Device ${visit.deviceId.slice(0, 8)}`}` : '';
  meta.textContent = `${visit.site} · ${new Date(visit.visitedAt).toLocaleString()} · ${visit.format || 'webpage'} · ${time}${device}`;
  save.type = 'button';
  save.textContent = 'Save labels';
  remove.type = 'button';
  remove.textContent = 'Delete visit';
  source.textContent = visit.labelSource === 'learned'
    ? `learned from ${visit.learnedFrom} corrections`
    : visit.labelSource || 'earlier record';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const local = localVisits.some(item => item.id === visit.id &&
        (!visit.cloudId || item.cloudId === visit.cloudId));
      if (local) {
        const saved = await setVisitLabels(visit.id, purpose.value, topic.value);
        if (!saved) throw new Error('Visit no longer exists');
      } else {
        const result = await chrome.runtime.sendMessage({
          type: 'correctCloudVisit', cloudId: visit.cloudId,
          purpose: purpose.value, topic: topic.value
        });
        if (!result?.ok) throw new Error(result?.error || 'Could not save cloud labels.');
      }
      if (purpose.value !== 'unknown' || topic.value !== 'unknown') {
        learnedExamples = saveExample(learnedExamples,
          makeExample(visit, purpose.value, topic.value));
      } else {
        learnedExamples = learnedExamples.filter(example => example.id !==
          (visit.cloudId || visit.id));
      }
      allLearnedExamples = [
        ...allLearnedExamples.filter(example => example.accountUid !== account.uid),
        ...learnedExamples
      ];
      await chrome.storage.local.set({ learnedExamples: allLearnedExamples });
      visit.purpose = purpose.value;
      visit.topic = topic.value;
      visit.labelSource = 'manual';
      showLearningCount();
      status.textContent = 'Labels saved locally for future visits.';
      render();
    } catch {
      status.textContent = 'Could not save labels. Try again.';
      save.disabled = false;
    }
  });
  remove.addEventListener('click', async () => {
    if (!confirm('Delete this visit permanently?')) return;
    remove.disabled = true;
    const result = await chrome.runtime.sendMessage(visit.cloudId && account.configured
      ? { type: 'deleteSyncedVisit', cloudId: visit.cloudId }
      : { type: 'deleteVisit', id: visit.id });
    if (result?.ok) await reload();
    else {
      status.textContent = result?.error || 'Could not delete visit.';
      remove.disabled = false;
    }
  });
  labels.append(purpose, topic, save, remove, source);
  item.append(title, meta, labels);
  return item;
}

function showTimeline(rows) {
  const format = formatFilter.value;
  const purpose = purposeFilter.value;
  const search = textFilter.value.trim().toLowerCase();
  const matching = rows.filter(visit =>
    (format === 'all' || (visit.format || 'webpage') === format) &&
    (purpose === 'all' || (visit.purpose || 'unknown') === purpose) &&
    (!search || `${visit.title} ${visit.site} ${visit.searchQuery || ''}`.toLowerCase().includes(search)));
  timeline.replaceChildren();
  for (const visit of matching.slice(0, 100)) timeline.append(visitRow(visit));
  document.getElementById('timeline-count').textContent =
    `Showing ${Math.min(matching.length, 100)} of ${matching.length} matching visits, newest first.`;
  if (!matching.length) timeline.textContent = 'No visits match these filters.';
}

function render() {
  const rows = selectedVisits();
  showTotals(rows);
  showTimeline(rows);
}

function showDevices() {
  const selected = deviceFilter.value;
  deviceFilter.replaceChildren(new Option('All devices', 'all'));
  for (const id of new Set(visits.map(visit => visit.deviceId).filter(Boolean))) {
    const name = id === account.deviceId ? 'This device' : `Device ${id.slice(0, 8)}`;
    deviceFilter.append(new Option(name, id));
  }
  deviceFilter.value = [...deviceFilter.options].some(option => option.value === selected)
    ? selected : 'all';
}

function showAccount() {
  const label = document.getElementById('account-status');
  const signedIn = account.configured && account.signedIn;
  document.getElementById('account-sign-in').hidden = !account.configured || signedIn;
  document.getElementById('sync-now').hidden = !signedIn;
  document.getElementById('sign-out').hidden = !signedIn;
  document.getElementById('import-older').hidden = !signedIn ||
    !localVisits.some(visit => !visit.accountUid);
  document.getElementById('archive-file').hidden = !signedIn;
  document.getElementById('clear').textContent = signedIn
    ? 'Delete all synced history' : 'Delete all history';
  if (!account.configured) label.textContent = 'Local build. See README to set up Google sign-in.';
  else if (!signedIn) label.textContent = 'Sign in with Google to start recording.';
  else label.textContent = `${account.email || 'Google account'} · ${account.lastSync
    ? `last sync ${new Date(account.lastSync).toLocaleString()}` : 'waiting for first sync'}${
    account.syncError ? ` · ${account.syncError}` : ''}`;
}

function settingRow(text, onRemove) {
  const item = document.createElement('li');
  const label = document.createElement('span');
  const remove = document.createElement('button');
  label.textContent = text;
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.addEventListener('click', onRemove);
  item.append(label, remove);
  return item;
}

function showSettings() {
  const ruleList = document.getElementById('rule-list');
  const excludeList = document.getElementById('exclude-list');
  ruleList.replaceChildren();
  excludeList.replaceChildren();
  for (const rule of rules) {
    ruleList.append(settingRow(
      `${rule.site} · ${rule.purpose} · ${rule.topic}`, async () => {
        rules = rules.filter(item => item.site !== rule.site);
        await chrome.storage.local.set({ rules });
        showSettings();
        status.textContent = 'Rule removed.';
      }
    ));
  }
  for (const site of excludedSites) {
    excludeList.append(settingRow(site, async () => {
      excludedSites = excludedSites.filter(item => item !== site);
      await chrome.storage.local.set({ excludedSites });
      showSettings();
      status.textContent = 'Exclusion removed.';
    }));
  }
  if (!rules.length) ruleList.textContent = 'No site rules yet.';
  if (!excludedSites.length) excludeList.textContent = 'No excluded sites.';
}

function showLearningCount() {
  const count = learnedExamples.length;
  document.getElementById('learning-count').textContent = count
    ? `${count} corrected ${count === 1 ? 'visit' : 'visits'} saved for learning.`
    : 'No corrections saved for learning yet.';
}

document.getElementById('reset-learning').addEventListener('click', async () => {
  allLearnedExamples = allLearnedExamples.filter(example => example.accountUid !== account.uid);
  await chrome.storage.local.set({ learnedExamples: allLearnedExamples });
  learnedExamples = [];
  showLearningCount();
  status.textContent = 'Learned patterns forgotten. Manual visit labels remain.';
});

document.getElementById('rule-form').addEventListener('submit', async event => {
  event.preventDefault();
  const site = normalizeSite(document.getElementById('rule-site').value);
  if (!site) {
    status.textContent = 'Enter a valid website hostname.';
    return;
  }
  const purpose = document.getElementById('rule-purpose').value;
  const topic = document.getElementById('rule-topic').value;
  if (!PURPOSES.includes(purpose) || !TOPICS.includes(topic)) return;
  rules = [{ site, purpose, topic }, ...rules.filter(item => item.site !== site)];
  await chrome.storage.local.set({ rules });
  document.getElementById('rule-site').value = '';
  showSettings();
  status.textContent = `Rule saved for ${site}.`;
});

document.getElementById('exclude-form').addEventListener('submit', async event => {
  event.preventDefault();
  const site = normalizeSite(document.getElementById('exclude-site').value);
  if (!site) {
    status.textContent = 'Enter a valid website hostname.';
    return;
  }
  excludedSites = [...new Set([...excludedSites, site])].sort();
  await chrome.storage.local.set({ excludedSites });
  await chrome.runtime.sendMessage({ type: 'history' });
  document.getElementById('exclude-site').value = '';
  showSettings();
  status.textContent = `Future visits to ${site} will be excluded.`;
});

document.getElementById('export').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'history' });
  const data = {
    version: 3, exportedAt: new Date().toISOString(),
    visits, rules, excludedSites, learnedExamples
  };
  const address = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json'
  }));
  const link = document.createElement('a');
  link.href = address;
  link.download = `browselog-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
  status.textContent = 'Local JSON export started.';
});

document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm(account.configured && account.signedIn
    ? 'Delete all synced visits from every device permanently?'
    : 'Delete all saved visits and searches permanently?')) return;
  const result = await chrome.runtime.sendMessage({ type: 'clearHistory' });
  if (result?.ok) {
    await reload();
    status.textContent = 'History deleted. New visits start on the next page load.';
  } else status.textContent = result?.error || 'Could not delete history.';
});

async function reload() {
  status.textContent = 'Updating activity…';
  try {
    await chrome.runtime.sendMessage({ type: 'history' });
    localVisits = await allVisits();
    account = await chrome.runtime.sendMessage({ type: 'account' });
    if (account?.error) throw new Error(account.error);
    const { localDeviceId } = await chrome.storage.local.get('localDeviceId');
    account.deviceId = localDeviceId;
    let cloudError = '';
    if (account.configured && account.signedIn) {
      try {
        const cloud = await chrome.runtime.sendMessage({ type: 'cloudHistory' });
        if (cloud?.error) throw new Error(cloud.error);
        const { pendingDeletes = {} } = await chrome.storage.local.get('pendingDeletes');
        visits = combineVisits(localVisits, cloud.visits, account.uid,
          [...cloud.deletions, ...(pendingDeletes[account.uid] || [])]);
      } catch (error) {
        visits = localVisits.filter(visit => visit.accountUid === account.uid);
        cloudError = error.message;
      }
    } else visits = account.configured ? [] : localVisits;
    const settings = await chrome.storage.local.get(['rules', 'excludedSites', 'learnedExamples']);
    rules = Array.isArray(settings.rules) ? settings.rules : [];
    excludedSites = Array.isArray(settings.excludedSites) ? settings.excludedSites : [];
    allLearnedExamples = Array.isArray(settings.learnedExamples) ? settings.learnedExamples : [];
    learnedExamples = allLearnedExamples.filter(example => example.accountUid === account.uid);
    showDevices();
    render();
    showSettings();
    showLearningCount();
    showAccount();
    status.textContent = cloudError
      ? `Showing ${visits.length} local visits. Cloud sync failed: ${cloudError}`
      : `Loaded ${visits.length} visits${account.signedIn ? ' across devices' : ' locally'}.`;
  } catch {
    status.textContent = 'Could not load activity. Try refreshing the page.';
  }
}

range.addEventListener('change', render);
formatFilter.addEventListener('change', render);
purposeFilter.addEventListener('change', render);
textFilter.addEventListener('input', render);
document.getElementById('reload').addEventListener('click', reload);
deviceFilter.addEventListener('change', render);
document.getElementById('sync-now').addEventListener('click', reload);
document.getElementById('account-sign-in').addEventListener('click', async () => {
  status.textContent = 'Opening Google sign-in…';
  const result = await chrome.runtime.sendMessage({ type: 'signIn' });
  if (result?.ok) await reload();
  else status.textContent = result?.error || 'Sign-in failed.';
});
document.getElementById('sign-out').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'signOut' });
  if (result?.ok) await reload();
  else status.textContent = result?.error || 'Could not sign out.';
});
document.getElementById('import-older').addEventListener('click', async () => {
  if (!confirm('Upload older local browsing history to this Google account?')) return;
  const result = await chrome.runtime.sendMessage({ type: 'importOlder' });
  if (result?.ok) {
    await reload();
    status.textContent = `Uploaded ${result.count} older visits.`;
  } else status.textContent = result?.error || 'Could not upload older visits.';
});
document.getElementById('archive-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file || !account.signedIn) return;
  try {
    if (file.size > 20_000_000) throw new Error('Choose an export smaller than 20 MB.');
    const raw = await file.text();
    const archive = JSON.parse(raw);
    if (!Array.isArray(archive.visits) || archive.visits.length > 10000) {
      throw new Error('Choose a BrowseLog JSON export with at most 10,000 visits.');
    }
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(raw)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const { importedArchives = {} } = await chrome.storage.local.get('importedArchives');
    const earlier = importedArchives[account.uid] || [];
    if (earlier.includes(digest)) throw new Error('This archive was already imported.');
    if (!confirm(`Import ${archive.visits.length} visits into ${account.email}?`)) return;
    const count = await importArchiveVisits(archive.visits, account.uid, account.deviceId);
    importedArchives[account.uid] = [...earlier, digest];
    await chrome.storage.local.set({ importedArchives });
    await reload();
    status.textContent = `Imported ${count} visits. Cloud sync will upload them.`;
  } catch (error) { status.textContent = error.message; }
  finally { event.target.value = ''; }
});
reload();
