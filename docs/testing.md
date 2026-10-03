# Checking a change

Check JavaScript syntax from the repository root:

```bash
node --check src/popup.js
node --check src/background.js
npm test
npm run test:browser
npm run test:sync
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
- Search Google, Bing, or YouTube: the query should appear under Recent searches.
- Change a YouTube search without reloading: the new query should get a new row.
- Change only an extra search URL parameter: do not make a duplicate row.
- Reload a search results page: make a new visit for the same query.
- Search while paused: do not save a new search.
- Search an unsupported site: keep the visit, without a Recent searches row.
- Open two YouTube watch URLs: each video should appear separately, even though
  their saved URLs both end in `/watch`.
- Move from a watch page to Shorts without a reload: record a new Shorts visit.
- Change only the video timestamp in the URL: do not make a duplicate row.
- Change the page title after a same-page video switch: update that visit's title.
- Reload a video page: make a new visit for the same video.
- Open a video while paused, then resume: it should get a new visit on resume.
- Confirm the video list shows only the newest ten videos and Shorts.
- Play a YouTube video while its tab is selected: Playing estimate should rise.
- Pause the player or switch tabs: Playing estimate should stop rising.
- Leave the video playing without input: playback may rise while active time
  stops after the idle threshold. Lock the computer: playback should stop too.
- Correct several pages from one site in the dashboard. A new page there should
  show a learned label; an explicit site rule should still win.
- Correct similar videos and then an unrelated video. Only the similar one
  should pick up the learned label. Shorts stay separate from regular videos.
- Use **Forget learned patterns**. Earlier manual labels should remain, while
  new visits return to keyword or rule labels.
- Delete a corrected visit and check that its example is gone. Deleting all
  history should clear every example.
- Build `dist/` with a Firebase project, then sign in on Chrome and Arc using
  the same Google account. Open different pages in each browser and confirm the
  combined dashboard shows both devices once.
- Turn off the network on one browser, visit a page, then reconnect. Sync should
  upload it without duplicating an earlier visit.
- Correct a visit from the other browser, then add active time on its original
  browser. The manual label should remain after sync.
- Delete a synced visit from one browser while the other is offline. Reconnect
  the other browser; the visit should stay deleted.
- Sign in with a different account. The first account's visits must not appear.

The first idle threshold interval still counts, so this remains an estimate.
Other same-page app navigation is not recorded yet. The final interval may be partly
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

## Milestone 6 results

Unit tests cover supported engines, empty queries, unrelated pages, lookalike
domains, whitespace, URL sanitizing, and search timing. The browser test uses
temporary HTTPS pages under Google, Bing, and YouTube hostnames to check full
search loads, same-page changes, duplicate prevention, reloads, popup display,
and pause. Live sites still need a manual check because their page behavior
can change.

## Milestone 7 results

Unit tests check watch and Shorts URL parsing, video ID validation, lookalike
hosts, URL sanitizing, and separate timing for videos sharing the `/watch` URL.
The isolated Chrome test checks full loads, same-page switches, title changes,
duplicate prevention, reloads, pause/resume, and the ten-video list limit.
Playback is not measured yet; the displayed time is active tab time.

## Playback results

The isolated Chrome test plays a local canvas stream in a YouTube-shaped page.
It checks that playback time grows and then stops after pausing the video. The
worker accepts short intervals only for the selected, visible YouTube tab and
keeps playback and active-time overlap separately. Real idle and screen-lock
transitions still need a manual check.

## Content labels

Unit tests check format, purpose, and topic independently. A gaming tutorial can
be learning and gaming at once; an unknown Short stays unknown. The browser test
checks that a video title update changes its automatic purpose label.

## Activity dashboard

The browser test opens the activity page, checks totals and timeline filters,
then corrects a video's purpose and topic. Unit tests check that active browsing
and playback overlap is counted once in totals, including older visit records.

## Privacy controls

The isolated Chrome test adds a site rule, checks its labels on a new visit,
excludes a search site, deletes one visit, downloads a local JSON export, and
clears all history. It then opens a new page to check that recording can restart.
Unit tests cover exact-site and subdomain matching without matching lookalikes.
