import { firebaseConfig } from './config.js';

const authUrl = firebaseConfig.authUrl || 'https://identitytoolkit.googleapis.com/v1';
const tokenUrl = firebaseConfig.tokenUrl || 'https://securetoken.googleapis.com/v1';
const firestoreUrl = firebaseConfig.firestoreUrl || 'https://firestore.googleapis.com/v1';

export function configured() {
  return Boolean(firebaseConfig.projectId && firebaseConfig.apiKey &&
    chrome.runtime.getManifest().oauth2?.client_id && firebaseConfig.webOAuthClientId);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Cloud request failed (${response.status})`);
  return body;
}

async function authRequest(path, body) {
  return jsonRequest(`${authUrl}/${path}?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}

export async function googleAccessToken() {
  try {
    const result = await chrome.identity.getAuthToken({
      interactive: true, scopes: ['openid', 'email', 'profile']
    });
    const token = typeof result === 'string' ? result : result?.token;
    if (token) return token;
  } catch { /* Arc and some other browsers do not support Chrome's token flow. */ }
  const redirect = chrome.identity.getRedirectURL();
  const state = crypto.randomUUID();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: firebaseConfig.webOAuthClientId,
    redirect_uri: redirect, response_type: 'token',
    scope: 'openid email profile', state, prompt: 'select_account'
  }).toString();
  const callback = await chrome.identity.launchWebAuthFlow({
    url: url.href, interactive: true
  });
  if (!callback) throw new Error('Google sign-in was cancelled.');
  const result = new URL(callback);
  const expected = new URL(redirect);
  const values = new URLSearchParams(result.hash.slice(1));
  if (result.origin !== expected.origin || result.pathname !== expected.pathname ||
      values.get('state') !== state || values.get('token_type')?.toLowerCase() !== 'bearer') {
    throw new Error('Google sign-in returned an unexpected response.');
  }
  const token = values.get('access_token');
  if (!token) throw new Error('Google sign-in did not return a token.');
  return token;
}

export async function signInWithGoogle() {
  if (!configured()) throw new Error('Cloud setup is missing. See the README.');
  const googleToken = await googleAccessToken();
  if (!googleToken) throw new Error('Google sign-in did not return a token.');
  const signedIn = await authRequest('accounts:signInWithIdp', {
    postBody: new URLSearchParams({
      access_token: googleToken, providerId: 'google.com'
    }).toString(),
    requestUri: 'http://localhost', returnSecureToken: true
  });
  const session = {
    uid: signedIn.localId, email: signedIn.email,
    idToken: signedIn.idToken, refreshToken: signedIn.refreshToken,
    expiresAt: Date.now() + Number(signedIn.expiresIn || 3600) * 1000
  };
  if (!session.uid || !session.idToken || !session.refreshToken) {
    throw new Error('Google sign-in returned an incomplete account.');
  }
  await chrome.storage.local.set({ authSession: session });
  return { uid: session.uid, email: session.email };
}

export async function signOut() {
  await chrome.storage.local.remove('authSession');
  await chrome.identity.clearAllCachedAuthTokens?.();
}

export async function currentSession() {
  const { authSession } = await chrome.storage.local.get('authSession');
  if (!authSession?.uid || !authSession.refreshToken) return null;
  if (authSession.expiresAt > Date.now() + 60_000) return authSession;
  const refreshed = await jsonRequest(
    `${tokenUrl}/token?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: authSession.refreshToken
      }).toString()
    });
  if (refreshed.user_id !== authSession.uid) throw new Error('Account changed during refresh.');
  const session = {
    ...authSession, idToken: refreshed.id_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000
  };
  await chrome.storage.local.set({ authSession: session });
  return session;
}

function collectionUrl(uid, collection = 'visits') {
  return `${firestoreUrl}/projects/${encodeURIComponent(firebaseConfig.projectId)}` +
    `/databases/(default)/documents/users/${encodeURIComponent(uid)}/${collection}`;
}

function documentUrl(uid, collection, cloudId) {
  return `${collectionUrl(uid, collection)}/${encodeURIComponent(cloudId)}`;
}

function headers(session) {
  return { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' };
}

export function cloudDocument(visit) {
  return { fields: {
    data: { stringValue: JSON.stringify(visit) },
    visitedAt: { integerValue: String(visit.visitedAt) },
    deviceId: { stringValue: visit.deviceId }
  } };
}

export function visitFromDocument(document) {
  const visit = JSON.parse(document.fields?.data?.stringValue || '{}');
  return visit.cloudId && visit.accountUid ? visit : null;
}

async function listDocuments(session, collection) {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(collectionUrl(session.uid, collection));
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: headers(session) });
    if (response.status === 404) return documents;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || `Could not load cloud visits (${response.status})`);
    documents.push(...(body.documents || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return documents;
}

export async function listCloudVisits(session) {
  return (await listDocuments(session, 'visits'))
    .map(visitFromDocument).filter(visit => visit?.accountUid === session.uid);
}

export async function listCloudDeletions(session) {
  return (await listDocuments(session, 'deletions'))
    .map(document => document.name?.split('/').pop()).filter(Boolean)
    .map(decodeURIComponent);
}

export async function uploadVisit(session, visit) {
  if (visit.accountUid !== session.uid || !visit.cloudId) throw new Error('Wrong account for upload.');
  return jsonRequest(documentUrl(session.uid, 'visits', visit.cloudId), {
    method: 'PATCH', headers: headers(session), body: JSON.stringify(cloudDocument(visit))
  });
}

export async function deleteCloudVisit(session, cloudId) {
  const response = await fetch(documentUrl(session.uid, 'visits', cloudId), {
    method: 'DELETE', headers: headers(session)
  });
  if (response.status === 404) return;
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message || `Could not delete cloud visit (${response.status})`);
  }
}

export async function writeCloudDeletion(session, cloudId) {
  return jsonRequest(documentUrl(session.uid, 'deletions', cloudId), {
    method: 'PATCH', headers: headers(session), body: JSON.stringify({
      fields: { deletedAt: { integerValue: String(Date.now()) } }
    })
  });
}
