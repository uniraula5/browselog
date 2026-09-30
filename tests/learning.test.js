import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyVisit } from '../src/labels.js';
import { makeExample, removeExample, saveExample, words } from '../src/learning.js';

const video = (id, title, purpose = 'learning', topic = 'education') =>
  makeExample({ id, site: 'www.youtube.com', title, format: 'video' }, purpose, topic);

test('manual corrections replace earlier examples for the same visit', () => {
  const first = video(1, 'History of the moon');
  const changed = video(1, 'History of the moon', 'entertainment', 'other');
  assert.deepEqual(saveExample([first], changed), [changed]);
  assert.deepEqual(removeExample([changed], 1), []);
  assert.deepEqual([...words('The Python course part 2')], ['python', 'course']);
  assert.equal(makeExample({ id: 2, title: 'x'.repeat(600) }, 'other', 'other').text.length, 500);
});

test('two similar videos teach future videos but not unrelated ones', () => {
  const examples = [
    video(1, 'Solar system planets explained'),
    video(2, 'Solar system planets documentary')
  ];
  const result = classifyVisit({
    site: 'youtube.com', title: 'Solar system planets overview', videoFormat: 'Video'
  }, [], examples);
  assert.equal(result.purpose, 'learning');
  assert.equal(result.topic, 'education');
  assert.equal(result.labelSource, 'learned');
  assert.equal(result.learnedFrom, 2);
  assert.equal(classifyVisit({
    site: 'www.youtube.com', title: 'Cooking dinner with friends', videoFormat: 'Video'
  }, [], examples).labelSource, 'automatic');
  assert.equal(classifyVisit({
    site: 'www.youtube.com', title: 'Solar system planets overview', videoFormat: 'Shorts'
  }, [], examples).labelSource, 'automatic');
});

test('sites need three consistent corrections and rules still win', () => {
  const examples = [1, 2, 3].map(id => makeExample({
    id, site: 'example.com', title: `Page ${id}`, format: 'webpage'
  }, 'information', 'news'));
  const visit = { site: 'example.com', title: 'Another page' };
  assert.equal(classifyVisit(visit, [], examples.slice(0, 2)).labelSource, 'automatic');
  assert.equal(classifyVisit(visit, [], examples).labelSource, 'learned');
  assert.equal(classifyVisit(visit, [{
    site: 'example.com', purpose: 'learning', topic: 'education'
  }], examples).labelSource, 'rule');
  assert.equal(classifyVisit({ ...visit, site: 'different.com' }, [], examples)
    .labelSource, 'automatic');
});

test('conflicting corrections do not force a category', () => {
  const examples = [
    video(1, 'Solar system planets explained', 'learning', 'education'),
    video(2, 'Solar system planets documentary', 'entertainment', 'other')
  ];
  assert.equal(classifyVisit({
    site: 'www.youtube.com', title: 'Solar system planets overview', videoFormat: 'Video'
  }, [], examples).labelSource, 'automatic');
});
