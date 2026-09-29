import test from 'node:test';
import assert from 'node:assert/strict';
import { focusedVisit, changeFocus } from '../src/tracker.js';

const tab = { id: 1, active: true, status: 'complete', url: 'https://example.com/' };
const visits = { 1: { id: 10, url: tab.url }, 2: { id: 20, url: tab.url } };
const window = { focused: true, state: 'normal', tabs: [tab, { ...tab, id: 2, active: false }] };

test('only the selected tab in the focused window earns time', () => {
  assert.equal(focusedVisit(window, visits, false), 10);
  assert.equal(focusedVisit({ ...window, focused: false }, visits, false), null);
  assert.equal(focusedVisit({ ...window, state: 'minimized' }, visits, false), null);
  assert.equal(focusedVisit(window, visits, true), null);
});

test('idle and locked states stop timing even when the tab stays selected', () => {
  assert.equal(focusedVisit(window, visits, false, 'idle'), null);
  assert.equal(focusedVisit(window, visits, false, 'locked'), null);
  assert.equal(focusedVisit(window, visits, false, 'active'), 10);
});

test('idle ends the interval and a new input starts one without the idle gap', () => {
  const idle = changeFocus({ visitId: 10, startedAt: 1000 }, focusedVisit(window, visits, false, 'idle'), 31000);
  const active = changeFocus(idle.current, focusedVisit(window, visits, false, 'active'), 90000);
  const switched = changeFocus(active.current, 20, 95000);
  assert.equal(idle.finished.milliseconds, 30000);
  assert.equal(active.finished, null);
  assert.equal(switched.finished.milliseconds, 5000);
  assert.equal(idle.finished.milliseconds + switched.finished.milliseconds, 35000);
});

test('repeated idle checks and an unlock while paused cannot add time', () => {
  const stopped = changeFocus({ visitId: 10, startedAt: 1000 },
    focusedVisit(window, visits, false, 'locked'), 4000);
  const stillLocked = changeFocus(stopped.current,
    focusedVisit(window, visits, false, 'locked'), 15000);
  const unlockedButPaused = changeFocus(stillLocked.current,
    focusedVisit(window, visits, true, 'active'), 20000);
  const resumed = changeFocus(unlockedButPaused.current,
    focusedVisit(window, visits, false, 'active'), 30000);
  const ended = changeFocus(resumed.current, null, 32000);
  assert.equal(stopped.finished.milliseconds, 3000);
  assert.equal(stillLocked.finished, null);
  assert.equal(unlockedButPaused.finished, null);
  assert.equal(resumed.finished, null);
  assert.equal(ended.finished.milliseconds, 2000);
});

test('ignores private, loading, discarded, unsupported, and unrecorded pages', () => {
  for (const change of [
    { incognito: true }, { status: 'loading' }, { discarded: true },
    { url: 'chrome://extensions' }, { url: 'https://different.example/' }, { id: 3 }
  ]) {
    assert.equal(focusedVisit({ ...window, tabs: [{ ...tab, ...change }] }, visits, false), null);
  }
  assert.equal(focusedVisit(null, visits, false), null);
});

test('switching tabs closes the first interval and starts the next', () => {
  const result = changeFocus({ visitId: 10, startedAt: 1000 }, 20, 4000);
  assert.deepEqual(result.finished, { visitId: 10, milliseconds: 3000 });
  assert.deepEqual(result.current, { visitId: 20, startedAt: 4000 });
});

test('repeated refreshes count elapsed time once', () => {
  const first = changeFocus(null, 10, 1000);
  const second = changeFocus(first.current, 10, 3000);
  const third = changeFocus(second.current, 10, 4000);
  assert.equal(first.finished, null);
  assert.equal(second.finished.milliseconds + third.finished.milliseconds, 3000);
});

test('pause or loss of focus leaves a gap until focus resumes', () => {
  const stopped = changeFocus({ visitId: 10, startedAt: 1000 }, null, 2000);
  const resumed = changeFocus(stopped.current, 10, 9000);
  assert.equal(stopped.finished.milliseconds, 1000);
  assert.equal(resumed.finished, null);
  assert.equal(resumed.current.startedAt, 9000);
});

test('a backward clock adjustment never subtracts saved time', () => {
  assert.equal(changeFocus({ visitId: 10, startedAt: 3000 }, null, 2000).finished.milliseconds, 0);
});
