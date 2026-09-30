import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSite, siteMatches, isExcluded } from '../src/settings.js';
import { classifyVisit } from '../src/labels.js';

test('accepts a site or URL and keeps only its hostname', () => {
  assert.equal(normalizeSite('Example.COM'), 'example.com');
  assert.equal(normalizeSite('https://WWW.Example.com/path?q=private'), 'www.example.com');
  assert.equal(normalizeSite('127.0.0.1'), '127.0.0.1');
});

test('rejects unsupported or malformed site entries', () => {
  for (const value of ['', ' ', 'localhost', 'file:///tmp/a',
    'https://user:password@example.com', 'not a site']) {
    assert.equal(normalizeSite(value), null, value);
  }
});

test('exclusions include subdomains but not lookalikes', () => {
  assert.equal(siteMatches('www.youtube.com', 'youtube.com'), true);
  assert.equal(siteMatches('youtube.com', 'youtube.com'), true);
  assert.equal(siteMatches('notyoutube.com', 'youtube.com'), false);
  assert.equal(siteMatches('youtube.com.evil.example', 'youtube.com'), false);
  assert.equal(isExcluded('m.youtube.com', ['youtube.com']), true);
  assert.equal(isExcluded('youtube.com.evil.example', ['youtube.com']), false);
  assert.equal(isExcluded('youtube.com', {}), false);
});

test('site rules also apply to subdomains', () => {
  const result = classifyVisit({
    site: 'www.youtube.com', title: 'Minecraft gameplay', videoFormat: 'Video'
  }, [{ site: 'youtube.com', purpose: 'learning', topic: 'education' }]);
  assert.equal(result.purpose, 'learning');
  assert.equal(result.topic, 'education');
  assert.equal(result.labelSource, 'rule');
});
