import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch } from '../src/searches.js';
import { makeVisit } from '../src/storage.js';

test('reads ordinary Google search URLs', () => {
  assert.deepEqual(parseSearch('https://www.google.com/search?q=web+extensions&source=hp'), {
    engine: 'Google', query: 'web extensions'
  });
  assert.deepEqual(parseSearch('https://google.co.uk/search?q=research%20methods'), {
    engine: 'Google', query: 'research methods'
  });
  assert.deepEqual(parseSearch('https://www.google.com.np/search?q=nepal'), {
    engine: 'Google', query: 'nepal'
  });
});

test('reads Bing and YouTube searches', () => {
  assert.deepEqual(parseSearch('https://www.bing.com/search?q=css+grid&form=QBLH'), {
    engine: 'Bing', query: 'css grid'
  });
  assert.deepEqual(parseSearch('https://www.youtube.com/results?search_query=history+lecture'), {
    engine: 'YouTube', query: 'history lecture'
  });
  assert.deepEqual(parseSearch('https://m.youtube.com/results?search_query=shorts'), {
    engine: 'YouTube', query: 'shorts'
  });
});

test('normalizes whitespace and limits saved query length', () => {
  const query = parseSearch('https://google.com/search?q=%20%20one%09two%0Athree%20');
  assert.deepEqual(query, { engine: 'Google', query: 'one two three' });
  const long = parseSearch(`https://bing.com/search?q=${'a'.repeat(700)}`);
  assert.equal(long.query.length, 500);
});

test('ignores unrelated pages and missing search terms', () => {
  for (const address of [
    'https://google.com/',
    'https://google.com/maps?q=coffee',
    'https://bing.com/images/search?q=cat',
    'https://youtube.com/watch?v=123&search_query=cat',
    'https://youtube.com/shorts/123?search_query=cat',
    'https://youtube.com/results',
    'https://bing.com/search?q=%20%20',
    'https://google.com/search?oq=old+query',
    'chrome://settings/',
    'not a url'
  ]) assert.equal(parseSearch(address), null, address);
});

test('does not trust similar looking search domains', () => {
  for (const address of [
    'https://google.com.evil.example/search?q=private',
    'https://notgoogle.com/search?q=private',
    'https://youtube.com.example/results?search_query=private',
    'https://bing.example/search?q=private'
  ]) assert.equal(parseSearch(address), null, address);
});

test('saves a supported query separately from the sanitized URL', () => {
  const visit = makeVisit({
    id: 4, title: 'Search results',
    url: 'https://www.google.com/search?q=biology+notes&auth=secret#section'
  }, 123);
  assert.equal(visit.url, 'https://www.google.com/search');
  assert.equal(visit.searchEngine, 'Google');
  assert.equal(visit.searchQuery, 'biology notes');
  assert.equal(visit.visitedAt, 123);
  assert.equal(JSON.stringify(visit).includes('auth=secret'), false);
});

test('private and ordinary pages do not get search fields', () => {
  assert.equal(makeVisit({
    incognito: true, url: 'https://www.google.com/search?q=private'
  }), null);
  const ordinary = makeVisit({
    id: 7, url: 'https://www.example.com/search?q=not+supported'
  });
  assert.equal('searchQuery' in ordinary, false);
  assert.equal('searchEngine' in ordinary, false);
});
