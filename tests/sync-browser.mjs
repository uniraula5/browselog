// Two isolated Chrome profiles share a fake cloud server in this test.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const chromePath = process.env.BROWSELOG_CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chromePath)) throw new Error('Set BROWSELOG_CHROME to Chrome for Testing.');
const root = path.resolve(import.meta.dirname, '..');
const buildDir = await mkdtemp(path.join(tmpdir(), 'browselog-build-'));
const documents = new Map();
let cloudOffline = false;
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (['/before-login', '/device-one', '/device-two', '/offline-visit'].includes(url.pathname)) {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<title>${url.pathname.slice(1)}</title>`);
    return;
  }
  const match = url.pathname.match(/\/documents\/users\/([^/]+)\/(visits|deletions)(?:\/([^/]+))?$/);
  const account = match && decodeURIComponent(match[1]);
  if (cloudOffline && match) {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'OFFLINE' } }));
    return;
  }
  if (!match || request.headers.authorization !== `Bearer user:${account}`) {
    response.writeHead(403, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }));
    return;
  }
  const prefix = `${account}/${match[2]}/`;
  const key = `${prefix}${decodeURIComponent(match[3] || '')}`;
  if (request.method === 'GET' && !match[3]) {
    const pageSize = Number(url.searchParams.get('pageSize')) || 100;
    const offset = Number(url.searchParams.get('pageToken')) || 0;
    const rows = [...documents.entries()].filter(([id]) => id.startsWith(prefix));
    const selected = rows.slice(offset, offset + pageSize).map(([id, document]) => ({
      ...document, name: `projects/test/databases/(default)/documents/users/${id}`
    }));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      documents: selected,
      ...(offset + pageSize < rows.length ? { nextPageToken: String(offset + pageSize) } : {})
    }));
    return;
  }
  if (request.method === 'PATCH' && match[3]) {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    documents.set(key, JSON.parse(raw));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(documents.get(key)));
    return;
  }
  if (request.method === 'DELETE' && match[3]) {
    documents.delete(key);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
    return;
  }
  response.writeHead(404);
  response.end('{}');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const configPath = path.join(root, 'config.test.json');
await writeFile(configPath, JSON.stringify({
  projectId: 'test', apiKey: 'test-key',
  oauthClientId: 'test-client.apps.googleusercontent.com',
  webOAuthClientId: 'test-web.apps.googleusercontent.com',
  authUrl: `${origin}/auth`, tokenUrl: `${origin}/token`,
  firestoreUrl: `${origin}/firestore`
}));
execFileSync('node', ['scripts/build.mjs', '--test'], {
  cwd: root, env: { ...process.env, BROWSELOG_BUILD_DIR: buildDir }
});

const browsers = [];
async function startBrowser(name, executable = chromePath) {
  const profile = await mkdtemp(path.join(tmpdir(), `browselog-${name}-`));
  const process = spawn(executable, [
    `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=0',
    `--disable-extensions-except=${buildDir}`,
    `--load-extension=${buildDir}`, 'about:blank'
  ], { stdio: 'ignore' });
  const instance = { process, profile, replies: new Map(), nextId: 0 };
  browsers.push(instance);
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      port = Number((await readFile(profile + '/DevToolsActivePort', 'utf8')).split('\n')[0]);
      if (port) break;
    } catch { /* Chrome is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!port) throw new Error(`${name} did not start`);
  const browserTarget = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  instance.socket = new WebSocket(browserTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    instance.socket.addEventListener('open', resolve, { once: true });
    instance.socket.addEventListener('error', reject, { once: true });
  });
  instance.socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    const pending = instance.replies.get(data.id);
    if (!pending) return;
    instance.replies.delete(data.id);
    if (data.error) pending.reject(new Error(data.error.message));
    else pending.resolve(data.result);
  });
  instance.command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++instance.nextId;
    instance.replies.set(id, { resolve, reject });
    instance.socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  instance.evaluate = async (sessionId, expression) => {
    const result = await instance.command('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    }, sessionId);
    if (result.exceptionDetails) throw new Error(
      result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  let worker;
  let workerSession;
  for (let attempt = 0; attempt < 100; attempt++) {
    const targets = await instance.command('Target.getTargets');
    for (const candidate of targets.targetInfos.filter(item =>
      item.type === 'service_worker' && item.url.endsWith('/background.js'))) {
      const session = (await instance.command('Target.attachToTarget', {
        targetId: candidate.targetId, flatten: true
      })).sessionId;
      let name;
      try { name = await instance.evaluate(session, `chrome.runtime.getManifest().name`); }
      catch { name = ''; }
      if (name === 'BrowseLog') {
        worker = candidate;
        workerSession = session;
        break;
      }
      await instance.command('Target.detachFromTarget', { sessionId: session });
    }
    if (worker) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!worker) throw new Error(`${name} extension worker did not start`);
  instance.extensionId = new URL(worker.url).hostname;
  instance.worker = workerSession;
  const target = await instance.command('Target.createTarget', {
    url: `chrome-extension://${instance.extensionId}/dashboard.html`
  });
  instance.dashboard = (await instance.command('Target.attachToTarget', {
    targetId: target.targetId, flatten: true
  })).sessionId;
  await instance.command('Runtime.enable', {}, instance.dashboard);
  await instance.command('Page.enable', {}, instance.dashboard);
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (await instance.evaluate(instance.dashboard,
        `location.protocol === 'chrome-extension:' && Boolean(document.getElementById('account-status'))`)) break;
      if (attempt % 10 === 9) await instance.command('Page.navigate', {
        url: `chrome-extension://${instance.extensionId}/dashboard.html`
      }, instance.dashboard);
    } catch { /* The new tab is still navigating. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return instance;
}

async function eventually(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  const first = await startBrowser('first');
  const second = await startBrowser('second', process.env.BROWSELOG_SECOND_BROWSER || chromePath);
  assert.equal(first.extensionId, second.extensionId);
  const evaluate = (browser, code) => browser.evaluate(browser.dashboard, code);
  const message = (browser, value) => evaluate(browser,
    `chrome.runtime.sendMessage(${JSON.stringify(value)})`);
  assert.equal((await message(first, { type: 'account' })).signedIn, false);
  await evaluate(first, `chrome.tabs.create({url:'${origin}/before-login',active:true})`);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal((await message(first, { type: 'history' })).visits.length, 0);
  for (const browser of [first, second]) {
    await evaluate(browser, `chrome.storage.local.set({authSession:{
      uid:'same-user', email:'tester@example.com', idToken:'user:same-user',
      refreshToken:'mock-refresh', expiresAt:Date.now()+3600000
    }})`);
  }
  await evaluate(first, `chrome.tabs.create({url:'${origin}/device-one',active:true})`);
  await evaluate(second, `chrome.tabs.create({url:'${origin}/device-two',active:true})`);
  await eventually(async () => (await message(first, { type: 'history' })).visits
    .some(visit => visit.url === `${origin}/device-one`), 'first device visit');
  await eventually(async () => (await message(second, { type: 'history' })).visits
    .some(visit => visit.url === `${origin}/device-two`), 'second device visit');
  const one = await message(first, { type: 'cloudHistory' });
  const two = await message(second, { type: 'cloudHistory' });
  assert.equal(one.error, undefined);
  assert.equal(two.error, undefined);
  assert.equal(two.visits.length, 2);
  await evaluate(second, `document.getElementById('reload').click()`);
  await eventually(async () => evaluate(second,
    `document.getElementById('status').textContent.includes('Loaded 2 visits')`),
  'combined dashboard');
  assert.equal(await evaluate(second,
    `document.getElementById('device-filter').options.length`), 3);
  cloudOffline = true;
  await evaluate(first, `chrome.tabs.create({url:'${origin}/offline-visit',active:true})`);
  await eventually(async () => (await message(first, { type: 'history' })).visits
    .some(visit => visit.url === `${origin}/offline-visit`), 'offline local visit');
  assert.equal((await message(first, { type: 'cloudHistory' })).error, 'OFFLINE');
  cloudOffline = false;
  assert.equal((await message(first, { type: 'cloudHistory' })).visits.length, 3);
  const firstVisit = one.visits.find(visit => visit.url === `${origin}/device-one`);
  assert.equal((await message(second, {
    type: 'correctCloudVisit', cloudId: firstVisit.cloudId,
    purpose: 'learning', topic: 'education'
  })).ok, true);
  assert.equal((await message(first, { type: 'cloudHistory' })).visits
    .find(visit => visit.cloudId === firstVisit.cloudId).purpose, 'learning');
  assert.equal((await message(second, {
    type: 'deleteSyncedVisit', cloudId: firstVisit.cloudId
  })).ok, true);
  await eventually(async () => (await message(first, { type: 'cloudHistory' })).visits.length === 2,
    'deletion across browsers');
  await evaluate(second, `chrome.storage.local.set({authSession:{
    uid:'other-user', email:'other@example.com', idToken:'user:other-user',
    refreshToken:'mock-refresh', expiresAt:Date.now()+3600000
  }})`);
  assert.equal((await message(second, { type: 'cloudHistory' })).visits.length, 0);
  assert.equal((await message(second, { type: 'history' })).visits.length, 0);
  console.log('PASS two isolated browser profiles: account gate, shared dashboard, correction, deletion, and account isolation.');
} finally {
  for (const browser of browsers) {
    browser.socket?.close();
    browser.process.kill();
    await rm(browser.profile, {
      recursive: true, force: true, maxRetries: 20, retryDelay: 100
    });
  }
  server.close();
  await rm(configPath, { force: true });
  await rm(buildDir, { recursive: true, force: true });
}
