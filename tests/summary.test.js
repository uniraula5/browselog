import test from 'node:test';
import assert from 'node:assert/strict';
import { engagedTime, summarize } from '../src/summary.js';

test('active and playback overlap is counted once', () => {
  const visit = { activeMs: 60_000, playbackMs: 90_000, overlapMs: 45_000 };
  assert.equal(engagedTime(visit), 105_000);
  assert.equal(summarize([visit]).engagedMs, 105_000);
});

test('an idle viewer can have playback without active time', () => {
  assert.equal(engagedTime({ activeMs: 0, playbackMs: 120_000 }), 120_000);
});

test('bad overlap does not make engaged time negative', () => {
  assert.equal(engagedTime({ activeMs: 1000, playbackMs: 1000, overlapMs: 9999 }), 1000);
  assert.equal(engagedTime({ activeMs: -1, playbackMs: -1, overlapMs: -1 }), 0);
});

test('summaries group time by independent purpose, topic, and format', () => {
  const rows = [
    {
      site: 'youtube.com', purpose: 'learning', topic: 'gaming', format: 'video',
      videoFormat: 'Video', activeMs: 30_000, playbackMs: 20_000, overlapMs: 10_000
    },
    {
      site: 'youtube.com', purpose: 'entertainment', topic: 'gaming',
      format: 'shorts', videoFormat: 'Shorts', activeMs: 10_000
    },
    {
      site: 'google.com', searchQuery: 'study', purpose: 'learning',
      topic: 'education', format: 'search', activeMs: 5_000
    }
  ];
  const result = summarize(rows);
  assert.equal(result.visits, 3);
  assert.equal(result.searches, 1);
  assert.equal(result.shorts, 1);
  assert.equal(result.activeMs, 45_000);
  assert.equal(result.playbackMs, 20_000);
  assert.equal(result.engagedMs, 55_000);
  assert.equal(result.purposes.learning, 45_000);
  assert.equal(result.topics.gaming, 50_000);
  assert.equal(result.formats.shorts, 10_000);
  assert.equal(result.sites['youtube.com'], 50_000);
});

test('older visits stay visible as unknown', () => {
  const result = summarize([{ site: 'old.example', focusedMs: 5000 }]);
  assert.equal(result.engagedMs, 5000);
  assert.equal(result.purposes.unknown, 5000);
  assert.equal(result.formats.webpage, 5000);
});
