import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideo } from '../src/videos.js';
import { makeVisit } from '../src/storage.js';

const firstId = 'aB_12345-Xy';
const secondId = 'z9Y_87654-a';

test('reads a YouTube watch URL without keeping the other parameters', () => {
  assert.deepEqual(parseVideo(`https://www.youtube.com/watch?v=${firstId}&list=private`), {
    id: firstId, format: 'Video'
  });
  assert.deepEqual(parseVideo(`https://m.youtube.com/watch?feature=share&v=${secondId}`), {
    id: secondId, format: 'Video'
  });
});

test('reads a Shorts URL with or without a trailing slash', () => {
  assert.deepEqual(parseVideo(`https://youtube.com/shorts/${firstId}`), {
    id: firstId, format: 'Shorts'
  });
  assert.deepEqual(parseVideo(`https://www.youtube.com/shorts/${secondId}/?feature=share`), {
    id: secondId, format: 'Shorts'
  });
});

test('ignores URLs that do not identify one video', () => {
  for (const url of [
    'https://www.youtube.com/',
    'https://www.youtube.com/results?search_query=math',
    'https://www.youtube.com/playlist?list=123',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=',
    'https://www.youtube.com/shorts',
    'https://www.youtube.com/shorts/',
    'https://www.youtube.com/shorts/not-long-enough',
    `https://www.youtube.com/shorts/${firstId}/comments`,
    'chrome://extensions/',
    'not a url'
  ]) assert.equal(parseVideo(url), null, url);
});

test('does not trust similar-looking hosts or paths', () => {
  for (const url of [
    `https://youtube.com.evil.example/watch?v=${firstId}`,
    `https://notyoutube.com/shorts/${firstId}`,
    `https://www.youtube.com/shortstory/${firstId}`,
    `https://youtube-nocookie.com/watch?v=${firstId}`,
    `https://www.youtube.com.evil.example/shorts/${firstId}`
  ]) assert.equal(parseVideo(url), null, url);
});

test('keeps distinct watch videos despite the sanitized URL being the same', () => {
  const first = makeVisit({
    id: 4, title: 'First lesson - YouTube',
    url: `https://www.youtube.com/watch?v=${firstId}&t=20`
  }, 100);
  const second = makeVisit({
    id: 4, title: 'Second lesson - YouTube',
    url: `https://www.youtube.com/watch?v=${secondId}&t=30`
  }, 200);
  assert.equal(first.url, 'https://www.youtube.com/watch');
  assert.equal(second.url, first.url);
  assert.equal(first.videoId, firstId);
  assert.equal(second.videoId, secondId);
  assert.equal(first.videoFormat, 'Video');
  assert.equal(first.searchQuery, undefined);
  assert.equal(JSON.stringify(first).includes('t=20'), false);
});

test('marks Shorts and excludes private tabs', () => {
  const short = makeVisit({
    id: 5, url: `https://www.youtube.com/shorts/${firstId}?feature=share`
  });
  assert.equal(short.videoId, firstId);
  assert.equal(short.videoFormat, 'Shorts');
  assert.equal(short.url, `https://www.youtube.com/shorts/${firstId}`);
  assert.equal(makeVisit({
    incognito: true, url: `https://www.youtube.com/watch?v=${firstId}`
  }), null);
});
