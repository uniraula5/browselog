// Runs the real extension in a temporary Chrome profile against local pages.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const chromePath = process.env.BROWSELOG_CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chromePath)) {
  throw new Error('Set BROWSELOG_CHROME to your Chrome or Chrome for Testing executable.');
}

const source = path.resolve('src');
const profile = await mkdtemp(path.join(tmpdir(), 'browselog-browser-'));
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<title>Local ${request.url.split('?')[0]}</title><h1>Local test page</h1>`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;

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
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
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

async function launch() {
  await rm(path.join(profile, 'DevToolsActivePort'), { force: true });
  browser = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-sync',
    '--disable-background-networking', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, `--disable-extensions-except=${source}`,
    `--load-extension=${source}`, 'about:blank'
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

try {
  await launch();
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
  assert.ok(first.activeMs >= 300, 'selected page should gain active time');

  const background = await evaluate(popup,
    `chrome.tabs.create({url:'${origin}/background',active:false})`);
  await eventually(async () => (await history()).visits.length === 2, 'background visit');
  assert.equal((await history()).visits[0].activeMs || 0, 0);
  await evaluate(popup, `chrome.tabs.update(${background.id},{active:true})`);
  await wait(100);
  const oldTotal = (await history()).visits.find(visit => visit.id === first.id).activeMs;
  await wait(450);
  assert.equal((await history()).visits.find(visit => visit.id === first.id).activeMs, oldTotal);
  assert.ok((await history()).visits[0].activeMs >= 300);

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
  const closed = once(browser, 'exit');
  await command('Browser.close');
  await closed;
  socket.close();
  socket = null;
  await launch();
  let restoredWorker;
  await eventually(async () => {
    const targets = (await command('Target.getTargets')).targetInfos;
    for (const target of targets.filter(item => item.type === 'service_worker')) {
      const session = await attach(target.targetId);
      const matching = await evaluate(session,
        `typeof chrome !== 'undefined' && chrome.runtime?.getManifest().name === 'BrowseLog'`);
      await command('Target.detachFromTarget', { sessionId: session });
      if (matching) restoredWorker = target;
    }
    return restoredWorker;
  }, 'worker after restart');
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

  console.log('PASS Chrome: visit privacy, selected-tab timing, background tabs, tab switches, idle setting, older labels, pause/resume, and restart persistence.');
  await command('Browser.close');
} finally {
  socket?.close();
  if (browser?.exitCode === null) browser.kill();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
