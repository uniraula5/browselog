import { allVisits, setVisitLabels } from './storage.js';
import { PURPOSES, TOPICS } from './labels.js';
import { engagedTime, summarize } from './summary.js';

const range = document.getElementById('range');
const formatFilter = document.getElementById('format-filter');
const purposeFilter = document.getElementById('purpose-filter');
const textFilter = document.getElementById('text-filter');
const status = document.getElementById('status');
const timeline = document.getElementById('timeline');
let visits = [];

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
  return visits.filter(visit => visit.visitedAt >= start);
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
  const source = document.createElement('small');
  title.className = 'visit-title';
  meta.className = 'visit-meta';
  labels.className = 'visit-labels';
  title.textContent = visit.title;
  const time = duration(engagedTime(visit));
  meta.textContent = `${visit.site} · ${new Date(visit.visitedAt).toLocaleString()} · ${visit.format || 'webpage'} · ${time}`;
  save.type = 'button';
  save.textContent = 'Save labels';
  source.textContent = visit.labelSource || 'earlier record';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await setVisitLabels(visit.id, purpose.value, topic.value);
      visit.purpose = purpose.value;
      visit.topic = topic.value;
      visit.labelSource = 'manual';
      status.textContent = 'Labels saved locally.';
      render();
    } catch {
      status.textContent = 'Could not save labels. Try again.';
      save.disabled = false;
    }
  });
  labels.append(purpose, topic, save, source);
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

async function reload() {
  status.textContent = 'Updating local activity…';
  try {
    await chrome.runtime.sendMessage({ type: 'history' });
    visits = await allVisits();
    render();
    status.textContent = `Loaded ${visits.length} local visits.`;
  } catch {
    status.textContent = 'Could not load activity. Try refreshing the page.';
  }
}

range.addEventListener('change', render);
formatFilter.addEventListener('change', render);
purposeFilter.addEventListener('change', render);
textFilter.addEventListener('input', render);
document.getElementById('reload').addEventListener('click', reload);
reload();
