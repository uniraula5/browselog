import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyVisit, contentFormat } from '../src/labels.js';

test('formats are separate from purpose and topic', () => {
  assert.equal(contentFormat({ videoFormat: 'Shorts' }), 'shorts');
  assert.equal(contentFormat({ videoFormat: 'Video' }), 'video');
  assert.equal(contentFormat({ searchQuery: 'biology' }), 'search');
  assert.equal(contentFormat({}), 'webpage');
});

test('gaming videos are labelled entertainment by default', () => {
  assert.deepEqual(classifyVisit({
    site: 'www.youtube.com', title: 'Minecraft gameplay', videoFormat: 'Video'
  }), {
    format: 'video', purpose: 'entertainment', topic: 'gaming', labelSource: 'automatic'
  });
});

test('a gaming tutorial can be learning and gaming at once', () => {
  assert.deepEqual(classifyVisit({
    site: 'www.youtube.com', title: 'Minecraft tutorial', videoFormat: 'Video'
  }), {
    format: 'video', purpose: 'learning', topic: 'gaming', labelSource: 'automatic'
  });
});

test('obvious entertainment titles get an entertainment purpose', () => {
  const video = classifyVisit({
    site: 'www.youtube.com', title: 'Funny cat comedy', videoFormat: 'Video'
  });
  assert.equal(video.purpose, 'entertainment');
  assert.equal(video.topic, 'unknown');
});

test('searches and Shorts are not automatically called entertainment', () => {
  assert.deepEqual(classifyVisit({
    site: 'www.youtube.com', title: 'Watch', videoFormat: 'Shorts'
  }), {
    format: 'shorts', purpose: 'unknown', topic: 'unknown', labelSource: 'automatic'
  });
  const search = classifyVisit({
    site: 'www.google.com', title: 'Search', searchQuery: 'python lesson'
  });
  assert.equal(search.format, 'search');
  assert.equal(search.purpose, 'learning');
  assert.equal(search.topic, 'technology');
});

test('a site rule wins over title clues', () => {
  const visit = {
    site: 'www.youtube.com', title: 'Minecraft gameplay', videoFormat: 'Video'
  };
  const rules = [{
    site: 'www.youtube.com', purpose: 'learning', topic: 'education'
  }];
  assert.deepEqual(classifyVisit(visit, rules), {
    format: 'video', purpose: 'learning', topic: 'education', labelSource: 'rule'
  });
  assert.equal(classifyVisit({ ...visit, site: 'other.example' }, rules).topic, 'gaming');
});

test('invalid rules and unknown content stay safe', () => {
  const visit = { site: 'example.com', title: 'Personal notes' };
  const rules = [null, { site: 'example.com', purpose: 'productive', topic: 'education' }];
  assert.deepEqual(classifyVisit(visit, rules), {
    format: 'webpage', purpose: 'unknown', topic: 'unknown', labelSource: 'automatic'
  });
  assert.equal(classifyVisit(visit, {}).purpose, 'unknown');
});
