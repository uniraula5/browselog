# Checking a change

Check JavaScript syntax from the repository root:

```bash
node --check src/popup.js
npm test
npm run test:browser
```

## Popup checks in Chrome

- Load `src/` unpacked and check the extension card for errors.
- Open a normal website: the popup should show its hostname and title.
- Click refresh: the button should become usable again after loading.
- Open a browser page: show a helpful message instead of an error.
- Check a long title: text should wrap without overflowing.
- Use Tab and Enter: the refresh button should have visible keyboard focus.
- Open three websites and check recent visits, newest first.
- Pause, load another page, and confirm it is not saved; resume and reload it.
- Reopen Chrome and confirm visits and the pause setting survive.
- Open a page in a background tab: save a visit without assigning time.
- Confirm private tabs and browser pages are excluded.
- Check a saved URL in IndexedDB: no credentials, query, or fragment.
- Switch between two pages: only the selected page should gain focused time.
- Change windows, minimize Chrome, or switch apps: previous timing should stop.
- Pause for several seconds and resume: the paused gap should not count.
- Refresh the popup twice: the first interval should not be added twice.
- Reload a website: the new visit should start with its own timer.
- Change the idle threshold and reopen the popup: the setting should persist.
- Leave Chrome untouched past the threshold: the current visit should stop growing.
- Return and interact: timing should resume without adding the idle gap.
- Lock the computer: timing should stop; unlock and interact to resume.
- Check older records: their timing should say "Focused (earlier version)".
- Restart Chrome: the idle threshold, pause setting, and visits should persist.
- Leave a page active for over 30 seconds: its saved time should increase even
  without opening the popup or switching tabs.
- Restart with open tabs: record new visits without counting the time Chrome
  was closed. A duplicate visit for one restored page is a bug.
- Open a page while paused, then resume: it should gain a fresh visit and timer.
- Sleep past a checkpoint: the delayed event should add at most 60 seconds.

The first idle threshold interval still counts, so this remains an estimate.
Same-page app navigation is not recorded yet. The final interval may be partly
lost on shutdown if the last checkpoint has not run.

## Milestone 2 results

The four automated filtering tests pass. An isolated Chrome for Testing profile
also passed recording, sanitized URLs, popup pause/resume, browser restart
persistence, repeated page loads, newest-first ordering, and the ten-row limit.
The browser checks used temporary local pages, not personal browsing history.

## Milestone 3 results

All ten unit tests pass. Isolated Chromium checks passed tab switching,
background tabs, window switching, minimizing, pause/resume, reloads, tab closure,
and focused-time rendering. The visit-history and persistence checks still pass.
Switching to a different desktop app remains a manual check; the unit tests cover
the unfocused-window state. Idle, sleep, and unfinished-interval recovery are pending.

## Milestone 4 results

The browser test uses an isolated Chrome profile and local web pages. It checks
visit privacy, timing when tabs change, pause/resume, threshold persistence, and
old timing labels. It also checks that settings and visits survive a restart.
The actual wait for idle and screen lock still need manual verification on a
desktop. The unit tests cover both idle and locked state transitions.

## Milestone 5 results

The browser test checks that an alarm fires and advances the saved checkpoint,
then restarts Chrome twice. It verifies pause and settings persistence, a fresh
visit after restart, and a visit for a page opened while paused when recording
resumes. The timing unit tests cover delayed alarms and regular checkpoints.
Real computer sleep still needs a manual check; alarms can run later than their
scheduled time, so a delayed interval is capped at one minute.
