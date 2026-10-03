import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('Google token becomes a Firebase account and refreshes before cloud use', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'browselog-cloud-'));
  const priorChrome = globalThis.chrome;
  const priorFetch = globalThis.fetch;
  const saved = {};
  const calls = [];
  try {
    await writeFile(path.join(folder, 'package.json'), '{"type":"module"}');
    await writeFile(path.join(folder, 'cloud.js'),
      await readFile(new URL('../src/cloud.js', import.meta.url)));
    await writeFile(path.join(folder, 'config.js'),
      `export const firebaseConfig = {
        projectId: 'demo', apiKey: 'public-key',
        webOAuthClientId: 'web.apps.googleusercontent.com'
      };`);
    globalThis.chrome = {
      runtime: { getManifest: () => ({ oauth2: { client_id: 'example.apps.googleusercontent.com' } }) },
      identity: {
        getAuthToken: async details => {
          assert.equal(details.interactive, true);
          assert.deepEqual(details.scopes, ['openid', 'email', 'profile']);
          return { token: 'google-token' };
        },
        clearAllCachedAuthTokens: async () => {}
      },
      storage: { local: {
        get: async key => typeof key === 'string' ? { [key]: saved[key] } : saved,
        set: async values => Object.assign(saved, values),
        remove: async key => { delete saved[key]; }
      } }
    };
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('signInWithIdp')) return {
        ok: true, json: async () => ({
          localId: 'user-one', email: 'student@example.com', idToken: 'firebase-token',
          refreshToken: 'refresh-one', expiresIn: '3600'
        })
      };
      if (String(url).includes('securetoken')) return {
        ok: true, json: async () => ({
          user_id: 'user-one', id_token: 'renewed-token',
          refresh_token: 'refresh-two', expires_in: '3600'
        })
      };
      return { ok: true, json: async () => ({}) };
    };
    const cloud = await import(pathToFileURL(path.join(folder, 'cloud.js')));
    assert.equal(cloud.configured(), true);
    assert.deepEqual(await cloud.signInWithGoogle(), {
      uid: 'user-one', email: 'student@example.com'
    });
    assert.equal(JSON.parse(calls[0].options.body).postBody,
      'access_token=google-token&providerId=google.com');
    saved.authSession.expiresAt = 0;
    const session = await cloud.currentSession();
    assert.equal(session.idToken, 'renewed-token');
    await assert.rejects(() => cloud.uploadVisit(session, {
      accountUid: 'another-user', cloudId: 'device-1'
    }), /Wrong account/);
    await cloud.uploadVisit(session, {
      accountUid: 'user-one', cloudId: 'device-1', deviceId: 'device', visitedAt: 1
    });
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer renewed-token');
    chrome.identity.getAuthToken = async () => { throw new Error('not supported in Arc'); };
    chrome.identity.getRedirectURL = () => 'https://extension-id.chromiumapp.org/';
    chrome.identity.launchWebAuthFlow = async details => {
      const request = new URL(details.url);
      assert.equal(request.searchParams.get('client_id'), 'web.apps.googleusercontent.com');
      assert.equal(request.searchParams.get('redirect_uri'),
        'https://extension-id.chromiumapp.org/');
      return `https://extension-id.chromiumapp.org/#access_token=arc-token&token_type=Bearer&state=${
        request.searchParams.get('state')}`;
    };
    assert.equal(await cloud.googleAccessToken(), 'arc-token');
    chrome.identity.launchWebAuthFlow = async () =>
      'https://extension-id.chromiumapp.org/#access_token=bad&token_type=Bearer&state=wrong';
    await assert.rejects(() => cloud.googleAccessToken(), /unexpected response/);
    await cloud.signOut();
    assert.equal(saved.authSession, undefined);
  } finally {
    globalThis.chrome = priorChrome;
    globalThis.fetch = priorFetch;
    await rm(folder, { recursive: true, force: true });
  }
});
