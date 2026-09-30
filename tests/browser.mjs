// Runs the real extension in a temporary Chrome profile against local pages.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';

const chromePath = process.env.BROWSELOG_CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chromePath)) {
  throw new Error('Set BROWSELOG_CHROME to your Chrome or Chrome for Testing executable.');
}

const source = path.resolve('src');
const profile = await mkdtemp(path.join(tmpdir(), 'browselog-browser-'));
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', path.join(profile, 'key.pem'),
  '-out', path.join(profile, 'cert.pem'),
  '-days', '1', '-subj', '/CN=www.bing.com'
], { stdio: 'ignore' });
const server = https.createServer({
  key: await readFile(path.join(profile, 'key.pem')),
  cert: await readFile(path.join(profile, 'cert.pem'))
}, (request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<title>Local ${request.url.split('?')[0]}</title><h1>Local test page</h1>`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `https://127.0.0.1:${server.address().port}`;
const bingOrigin = `https://www.bing.com:${server.address().port}`;
const googleOrigin = `https://www.google.com:${server.address().port}`;
const youtubeOrigin = `https://www.youtube.com:${server.address().port}`;

let browser;
let socket;
let commandId = 0;
const replies = new Map();
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function command(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => {
      replies.delete(id);
      reject(new Error(`Chrome did not answer ${method}`));
    }, 10000);
    replies.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); }
    });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function evaluate(sessionId, expression) {
  const response = await command('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true
  }, sessionId);
  if (response.exceptionDetails) throw new Error(
    response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}

async function attach(targetId) {
  return (await command('Target.attachToTarget', { targetId, flatten: true })).sessionId;
}

async function eventually(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function launch(startPage = 'about:blank') {
  await rm(path.join(profile, 'DevToolsActivePort'), { force: true });
  browser = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-sync',
    '--disable-background-networking', '--remote-debugging-port=0',
    '--no-proxy-server', '--ignore-certificate-errors',
    '--host-resolver-rules=MAP www.bing.com 127.0.0.1, MAP www.google.com 127.0.0.1, MAP www.youtube.com 127.0.0.1',
    `--user-data-dir=${profile}`, `--disable-extensions-except=${source}`,
    `--load-extension=${source}`, startPage
  ], { stdio: 'ignore' });
  let endpoint;
  await eventually(async () => {
    try {
      const [port, route] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
      endpoint = `ws://127.0.0.1:${port}${route}`;
      return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
    } catch { return false; }
  }, 'Chrome debugger');
  socket = new WebSocket(endpoint);
  await once(socket, 'open');
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data);
    if (!result.id) return;
    const reply = replies.get(result.id);
    replies.delete(result.id);
    if (result.error) reply.reject(new Error(JSON.stringify(result.error)));
    else reply.resolve(result.result);
  });
}

async function findWorker() {
  let worker;
  await eventually(async () => {
    const targets = (await command('Target.getTargets')).targetInfos;
    for (const target of targets.filter(item => item.type === 'service_worker')) {
      const session = await attach(target.targetId);
      const matching = await evaluate(session,
        `typeof chrome !== 'undefined' && chrome.runtime?.getManifest().name === 'BrowseLog'`);
      await command('Target.detachFromTarget', { sessionId: session });
      if (matching) worker = target;
    }
    return worker;
  }, 'BrowseLog worker');
  return worker;
}

async function restart(startPage) {
  const closed = once(browser, 'exit');
  await command('Browser.close');
  await closed;
  socket.close();
  socket = null;
  await launch(startPage);
}

try {
  await launch();
  const worker = await findWorker();

  const popupUrl = worker.url.replace('background.js', 'popup.html');
  const popup = await attach((await command('Target.createTarget', { url: popupUrl })).targetId);
  await eventually(() => evaluate(popup, `document.getElementById('pause')?.disabled === false`), 'popup');
  const message = details => evaluate(popup, `chrome.runtime.sendMessage(${JSON.stringify(details)})`);
  const history = () => message({ type: 'history' });

  assert.equal((await history()).idleSeconds, 60);
  assert.equal((await history()).visits.length, 0);
  const page = await evaluate(popup,
    `chrome.tabs.create({url:'${origin}/first?token=secret#private',active:true})`);
  await evaluate(popup, `chrome.windows.update(${page.windowId},{focused:true})`);
  await eventually(async () => (await history()).visits.length === 1, 'first visit');
  let first = (await history()).visits[0];
  assert.equal(first.url, `${origin}/first`);
  assert.equal(first.timingVersion, 2);
  await wait(450);
  first = (await history()).visits[0];
  if ((await history()).idleState === 'active') {
    assert.ok(first.activeMs >= 300, 'selected page should gain active time');
  } else {
    assert.equal(first.activeMs || 0, 0, 'an idle computer should not gain time');
  }
  const checkpoint = await evaluate(popup,
    `chrome.alarms.get('browselog-checkpoint')`);
  assert.equal(checkpoint.periodInMinutes, 0.5);
  const readSavedTime = () => evaluate(popup, `(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('browselog', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const milliseconds = await new Promise((resolve, reject) => {
      const request = db.transaction('visits').objectStore('visits').get(${first.id});
      request.onsuccess = () => resolve(request.result.activeMs || 0);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return milliseconds;
  })()`);
  if ((await history()).idleState === 'active') {
    const savedBeforeCheckpoint = await readSavedTime();
    const beforeCheckpoint = await evaluate(popup,
      `chrome.storage.session.get('focus').then(({focus}) => focus.startedAt)`);
    await evaluate(popup,
      `chrome.alarms.create('browselog-checkpoint', {when: Date.now() + 1000})`);
    await eventually(() => evaluate(popup,
      `chrome.storage.session.get('focus').then(({focus}) => focus?.startedAt > ${beforeCheckpoint})`),
    'checkpoint alarm');
    await eventually(async () => (await readSavedTime()) > savedBeforeCheckpoint,
      'checkpoint saved to IndexedDB');
    await evaluate(popup,
      `chrome.alarms.create('browselog-checkpoint', {periodInMinutes: 0.5})`);
  }

  const background = await evaluate(popup,
    `chrome.tabs.create({url:'${origin}/background',active:false})`);
  await eventually(async () => (await history()).visits.length === 2, 'background visit');
  assert.equal((await history()).visits[0].activeMs || 0, 0);
  await evaluate(popup, `chrome.tabs.update(${background.id},{active:true})`);
  await wait(100);
  const oldTotal = (await history()).visits.find(visit => visit.id === first.id).activeMs;
  await wait(450);
  assert.equal((await history()).visits.find(visit => visit.id === first.id).activeMs, oldTotal);
  if ((await history()).idleState === 'active') {
    assert.ok((await history()).visits[0].activeMs >= 300);
  } else {
    assert.equal((await history()).visits[0].activeMs || 0, 0);
  }

  const setting = await message({ type: 'idleSetting', seconds: 30 });
  assert.equal(setting.idleSeconds, 30);
  const rejected = await message({ type: 'idleSetting', seconds: 1 });
  assert.ok(rejected.error);
  assert.equal((await history()).idleSeconds, 30);
  assert.equal(await evaluate(popup,
    `chrome.idle.queryState(30).then(state => ['active','idle','locked'].includes(state))`), true);
  await evaluate(popup, `document.getElementById('refresh').click()`);
  await eventually(() => evaluate(popup, `document.getElementById('idle-seconds').value === '30'`), 'saved idle setting');
  await eventually(() => evaluate(popup,
    `document.getElementById('visits').textContent.includes('Active estimate')`), 'active time label');

  const paused = await message({ type: 'pause', paused: true });
  const pausedTotal = paused.visits[0].activeMs;
  await wait(450);
  assert.equal((await history()).visits[0].activeMs, pausedTotal);
  const resumed = await message({ type: 'pause', paused: false });
  await wait(450);
  const resumedTotal = (await history()).visits[0].activeMs;
  if (resumed.idleState === 'active') assert.ok(resumedTotal > pausedTotal);
  else assert.equal(resumedTotal, pausedTotal);

  // Older records must keep their earlier timing label after an extension update.
  await evaluate(popup, `(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('browselog', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite');
      transaction.objectStore('visits').add({
        url: '${origin}/older', site: '127.0.0.1', title: 'Older visit',
        tabId: 999, visitedAt: Date.now() + 1000, focusedMs: 5000
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  })()`);
  await evaluate(popup, `document.getElementById('refresh').click()`);
  await eventually(() => evaluate(popup,
    `document.getElementById('visits').textContent.includes('Focused (earlier version): 0m 5s')`),
  'earlier timing label');
  if (process.env.BROWSELOG_SCREENSHOT) {
    await command('Emulation.setDeviceMetricsOverride', {
      width: 350, height: 700, deviceScaleFactor: 1, mobile: false
    }, popup);
    const screenshot = await command('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true
    }, popup);
    await writeFile(process.env.BROWSELOG_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }

  await message({ type: 'pause', paused: true });
  await restart();
  const restoredWorker = await findWorker();
  const restoredPopup = await attach((await command('Target.createTarget', {
    url: restoredWorker.url.replace('background.js', 'popup.html')
  })).targetId);
  await eventually(() => evaluate(restoredPopup,
    `document.getElementById('pause')?.disabled === false`), 'popup after restart');
  const restored = await evaluate(restoredPopup, `chrome.runtime.sendMessage({type:'history'})`);
  assert.equal(restored.paused, true);
  assert.equal(restored.idleSeconds, 30);
  assert.equal(restored.visits.length, 3);
  assert.equal(restored.visits[0].title, 'Older visit');
  const pausedPage = await evaluate(restoredPopup,
    `chrome.tabs.create({url:'${origin}/still-paused',active:true})`);
  await eventually(() => evaluate(restoredPopup,
    `chrome.tabs.get(${pausedPage.id}).then(tab => tab.status === 'complete')`),
  'page opened while paused');
  assert.equal((await evaluate(restoredPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).visits.length, 3);
  await evaluate(restoredPopup, `chrome.runtime.sendMessage({type:'pause',paused:false})`);
  await eventually(() => evaluate(restoredPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.visits.some(visit => visit.url === '${origin}/still-paused'))`),
  'visit created on resume');

  const beforeRestart = await evaluate(restoredPopup,
    `chrome.runtime.sendMessage({type:'history'})`);
  const earlierTotal = beforeRestart.visits.find(visit => visit.id === first.id).activeMs;
  await restart(`${origin}/after-restart`);
  const startedWorker = await findWorker();
  const startedPopup = await attach((await command('Target.createTarget', {
    url: startedWorker.url.replace('background.js', 'popup.html')
  })).targetId);
  await eventually(() => evaluate(startedPopup,
    `document.getElementById('pause')?.disabled === false`), 'popup after second restart');
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.visits.some(visit => visit.url === '${origin}/after-restart'))`),
  'first visit after restart');
  const startedHistory = await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`);
  assert.equal(startedHistory.visits.filter(visit => visit.url === `${origin}/after-restart`).length, 1);
  assert.equal(startedHistory.visits.find(visit => visit.id === first.id).activeMs, earlierTotal);

  // Use a local web server under Bing's hostname to test the real extension.
  const searchedTab = await evaluate(startedPopup,
    `chrome.tabs.create({url:'${bingOrigin}/search?q=study+plan&form=QBLH',active:true})`);
  await eventually(() => evaluate(startedPopup,
    `chrome.tabs.get(${searchedTab.id}).then(tab => tab.status === 'complete')`),
  'local search page');
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.searches.length === 1)`),
  'first saved search');
  let searches = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).searches;
  assert.equal(searches[0].searchEngine, 'Bing');
  assert.equal(searches[0].searchQuery, 'study plan');
  assert.equal(searches[0].url, `${bingOrigin}/search`);
  await evaluate(startedPopup, `document.getElementById('refresh').click()`);
  await eventually(() => evaluate(startedPopup,
    `document.getElementById('searches').textContent.includes('study plan')`),
  'search shown in popup');

  let searchPage;
  await eventually(async () => {
    const targets = (await command('Target.getTargets')).targetInfos;
    searchPage = targets.find(target => target.type === 'page' &&
      target.url.startsWith(`${bingOrigin}/search`));
    return searchPage;
  }, 'search page target');
  const searchSession = await attach(searchPage.targetId);
  await evaluate(searchSession,
    `history.pushState({}, '', '/search?q=exam+schedule')`);
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.searches.length === 2)`),
  'search saved after pushState');
  searches = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).searches;
  assert.deepEqual(searches.map(row => row.searchQuery), ['exam schedule', 'study plan']);
  assert.equal(searches[0].url, searches[1].url);

  // A URL update with the same query should not make a duplicate row.
  await evaluate(searchSession,
    `history.pushState({}, '', '/search?q=exam+schedule&form=extra')`);
  await wait(300);
  assert.equal((await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).searches.length, 2);
  await evaluate(startedPopup, `document.getElementById('refresh').click()`);
  await eventually(() => evaluate(startedPopup,
    `document.getElementById('searches').textContent.includes('exam schedule')`),
  'second search shown in popup');

  // A real reload is a new visit, even if the query did not change.
  await evaluate(startedPopup, `chrome.tabs.reload(${searchedTab.id})`);
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.searches.length === 3)`),
  'new visit after search reload');
  searches = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).searches;
  assert.equal(searches[0].searchQuery, 'exam schedule');
  assert.equal(searches[1].searchQuery, 'exam schedule');

  const googleTab = await evaluate(startedPopup,
    `chrome.tabs.create({url:'${googleOrigin}/search?q=note+taking',active:true})`);
  await eventually(() => evaluate(startedPopup,
    `chrome.tabs.get(${googleTab.id}).then(tab => tab.status === 'complete')`),
  'local Google search page');
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.searches.length === 4)`),
  'Google search saved');
  searches = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).searches;
  assert.equal(searches[0].searchEngine, 'Google');
  assert.equal(searches[0].searchQuery, 'note taking');
  assert.equal(searches[0].url, `${googleOrigin}/search`);

  const youtubeTab = await evaluate(startedPopup,
    `chrome.tabs.create({url:'${youtubeOrigin}/results?search_query=calculus+lesson',active:true})`);
  await eventually(() => evaluate(startedPopup,
    `chrome.tabs.get(${youtubeTab.id}).then(tab => tab.status === 'complete')`),
  'local YouTube search page');
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.searches.length === 5)`),
  'YouTube search saved');
  searches = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).searches;
  assert.equal(searches[0].searchEngine, 'YouTube');
  assert.equal(searches[0].searchQuery, 'calculus lesson');
  assert.equal(searches[0].url, `${youtubeOrigin}/results`);

  let youtubePage;
  await eventually(async () => {
    const targets = (await command('Target.getTargets')).targetInfos;
    youtubePage = targets.find(target => target.type === 'page' &&
      target.url.startsWith(`${youtubeOrigin}/results`));
    return youtubePage;
  }, 'YouTube page target');
  const youtubeSession = await attach(youtubePage.targetId);
  await evaluate(youtubeSession,
    `history.pushState({}, '', '/results?search_query=linear+algebra')`);
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.searches.length === 6)`),
  'YouTube same-page search saved');
  searches = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).searches;
  assert.equal(searches[0].searchEngine, 'YouTube');
  assert.equal(searches[0].searchQuery, 'linear algebra');

  await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'pause',paused:true})`);
  await evaluate(youtubeSession,
    `history.pushState({}, '', '/results?search_query=paused+search')`);
  await wait(300);
  assert.equal((await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).searches.length, 6);

  const firstVideoTab = await evaluate(startedPopup,
    `chrome.tabs.create({url:'${youtubeOrigin}/watch?v=aB_12345-Xy&t=20',active:true})`);
  await eventually(() => evaluate(startedPopup,
    `chrome.tabs.get(${firstVideoTab.id}).then(tab => tab.status === 'complete')`),
  'watch page opened while paused');
  assert.equal((await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).videos.length, 0);
  await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'pause',paused:false})`);
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.videos.length === 1)`),
  'video saved when recording resumes');
  let videos = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).videos;
  assert.equal(videos[0].videoId, 'aB_12345-Xy');
  assert.equal(videos[0].videoFormat, 'Video');
  assert.equal(videos[0].url, `${youtubeOrigin}/watch`);
  assert.equal(JSON.stringify(videos[0]).includes('t=20'), false);
  if ((await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).idleState === 'active') {
    const { focus } = await evaluate(startedPopup,
      `chrome.storage.session.get('focus')`);
    assert.equal(focus.visitId, videos[0].id);
  }

  let watchPage;
  await eventually(async () => {
    const targets = (await command('Target.getTargets')).targetInfos;
    watchPage = targets.find(target => target.type === 'page' &&
      target.url.startsWith(`${youtubeOrigin}/watch`));
    return watchPage;
  }, 'watch page target');
  const watchSession = await attach(watchPage.targetId);
  await evaluate(watchSession,
    `history.pushState({}, '', '/watch?v=z9Y_87654-a')`);
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.videos.length === 2)`),
  'second watch video saved');
  videos = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).videos;
  assert.deepEqual(videos.map(video => video.videoId), ['z9Y_87654-a', 'aB_12345-Xy']);
  assert.equal(videos[0].url, videos[1].url);

  await evaluate(watchSession,
    `history.pushState({}, '', '/watch?v=z9Y_87654-a&t=45')`);
  await wait(300);
  assert.equal((await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).videos.length, 2);
  await evaluate(watchSession, `document.title = 'Second lesson - YouTube'`);
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.videos[0].title === 'Second lesson - YouTube')`),
  'video title updated');

  await evaluate(watchSession,
    `history.pushState({}, '', '/shorts/QwErTy12345')`);
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.videos.length === 3)`),
  'Shorts visit saved');
  videos = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).videos;
  assert.equal(videos[0].videoFormat, 'Shorts');
  assert.equal(videos[0].videoId, 'QwErTy12345');
  assert.equal(videos[0].url, `${youtubeOrigin}/shorts/QwErTy12345`);
  assert.equal(videos[0].title, 'Shorts on YouTube');
  await evaluate(watchSession, `document.title = 'Short lesson - YouTube'`);
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.videos[0].title === 'Short lesson - YouTube')`),
  'Shorts title updated');
  videos = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).videos;
  assert.equal(videos[1].title, 'Second lesson - YouTube');
  await evaluate(startedPopup, `document.getElementById('refresh').click()`);
  await eventually(() => evaluate(startedPopup,
    `document.getElementById('videos').textContent.includes('Shorts')`),
  'Shorts shown in popup');

  await evaluate(startedPopup, `chrome.tabs.reload(${firstVideoTab.id})`);
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.videos.length === 4)`),
  'new Shorts visit after reload');
  videos = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).videos;
  assert.equal(videos[0].videoId, 'QwErTy12345');
  assert.equal(videos[1].videoId, 'QwErTy12345');

  await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'pause',paused:true})`);
  await evaluate(watchSession,
    `history.pushState({}, '', '/watch?v=PaUsEd12345')`);
  await wait(300);
  assert.equal((await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).videos.length, 4);
  await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'pause',paused:false})`);
  await eventually(() => evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'}).then(result => result.videos.length === 5)`),
  'new video saved on resume');
  videos = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).videos;
  assert.equal(videos[0].videoId, 'PaUsEd12345');

  // The video list keeps its newest ten entries, separate from recent visits.
  for (let number = 0; number < 8; number++) {
    const videoId = `QwErTy${String(number).padStart(5, '0')}`;
    await evaluate(watchSession,
      `history.pushState({}, '', '/watch?v=${videoId}')`);
    await eventually(() => evaluate(startedPopup,
      `chrome.runtime.sendMessage({type:'history'}).then(result => result.videos[0]?.videoId === '${videoId}')`),
    `video ${number} saved`);
  }
  videos = (await evaluate(startedPopup,
    `chrome.runtime.sendMessage({type:'history'})`)).videos;
  assert.equal(videos.length, 10);
  assert.equal(videos[0].videoId, 'QwErTy00007');
  assert.equal(videos[9].videoId, 'QwErTy12345');

  console.log('PASS Chrome: visits, timing, restart, searches, videos, Shorts, title updates, and pause.');
  await command('Browser.close');
} finally {
  socket?.close();
  if (browser?.exitCode === null) browser.kill();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
