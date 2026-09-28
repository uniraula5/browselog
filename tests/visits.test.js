import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVisit } from '../src/storage.js';

test('removes credentials, query parameters, and fragments before saving', () => {
  const visit = makeVisit({ id: 3, url: 'https://user:secret@example.com/article?token=secret#private', title: ' Article ' }, 123);
  assert.deepEqual(visit, {
    url: 'https://example.com/article', site: 'example.com', title: 'Article', tabId: 3, visitedAt: 123
  });
});

test('excludes private tabs even when they have ordinary URLs', () => {
  assert.equal(makeVisit({ incognito: true, url: 'https://example.com' }), null);
});

test('ignores browser pages, files, missing URLs, and invalid URLs', () => {
  for (const url of ['chrome://extensions', 'file:///private.txt', 'about:blank', 'invalid', undefined]) {
    assert.equal(makeVisit({ url }), null);
  }
});

test('keeps background visits without assigning engagement time', () => {
  const visit = makeVisit({ id: 4, active: false, url: 'http://example.com', title: '' }, 456);
  assert.equal(visit.title, 'Untitled page');
  assert.equal(visit.visitedAt, 456);
  assert.equal(visit.url, 'http://example.com/');
  assert.equal('duration' in visit, false);
});
