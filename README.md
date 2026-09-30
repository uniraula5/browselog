# BrowseLog

A Chrome extension I'm building to understand where my browsing time goes.
I started this because hours online can feel productive even when most of
that time goes to unrelated videos and Shorts.

The goal is to separate engaged browsing, estimated video viewing, and idle
time, then show what content I spend time on. Activity history will stay local.

## Current version

Milestone 7 estimates active browsing time for the ten most recent visits. Only
the selected tab in the focused browser window earns time. Timing stops when the
browser loses focus, recording is paused, or the computer becomes idle or locked.
Choose a 30-second, 1-minute, 2-minute, or 5-minute idle threshold in the popup.
Recording starts when installed. A checkpoint saves the current timer about every
30 seconds. After a browser restart, open tabs get fresh visits when recording is
enabled, without counting the time Chrome was closed. Refresh or reopen the popup
to update the list. The popup also shows the ten most recent Google, Bing, and
YouTube searches. Search terms are saved when a results page opens, including
same-page searches that change the URL without reloading.
The popup also lists the ten most recent YouTube videos and Shorts, with an
active-time estimate for each visit. Switching videos inside YouTube starts a
new visit. A small script on YouTube pages also estimates actual video playback
while the tab is visible and Chrome is focused. Playback can continue counting
while the computer is idle, but stops when it is locked. Active and playback
time are stored separately; their overlap must be removed when making totals.
Other same-page app navigation is still a later milestone.
Simple title and search keywords suggest a topic and purpose. An uncertain page
stays **unknown**; the labels are guesses, not a measure of productivity.
The activity page has today, seven-day, and all-time totals, time breakdowns,
filters, and a timeline. You can correct the purpose and topic of each visit.
Engaged time subtracts overlap between active browsing and video playback.

Time starts after a recorded page load. The first idle threshold interval still
counts, so the number is an estimate of activity rather than proof of attention.
Older visits show their original focused-time value with a separate label, since
those values may include longer idle periods. The last few seconds of an
unfinished interval may be lost when Chrome closes. If an alarm fires late after
sleep, BrowseLog counts at most 60 seconds of that gap rather than the full gap.

## Install locally

1. Clone this repository or download and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this project's `src` folder.
5. Pin BrowseLog from the extensions menu.
6. Open a website and click the BrowseLog toolbar button.

After editing files, click **Reload** on the extension card and reopen the popup.
BrowseLog creates fresh visits for open tabs when the updated version starts.
No build step, account, or API key is needed.

## Privacy and permissions

The `tabs` permission reads page URLs and titles; `storage` saves settings and
keeps the current timer across background worker suspensions. The `idle`
permission detects computer inactivity and screen lock. The `alarms` permission
schedules timer checkpoints. `webNavigation` catches searches and video switches
inside sites that change the URL without a page load. Chrome 120 or newer is required.
A background worker saves visits in local IndexedDB. Nothing is sent off-device.
Incognito and non-web pages are excluded. URLs lose credentials, query parameters,
and fragments. Supported search terms are saved separately as plain text (up to
500 characters). YouTube video IDs and whether a visit was a video or Short are
saved separately. Paths, titles, search terms, and video IDs can contain personal
information.
Only Google, Bing, and YouTube search result URLs are parsed for terms; other
search engines still appear as ordinary visits.
Existing browser history is not imported. Background page loads count as visits,
not engaged time. Pausing keeps existing records; deletion controls come later.
For now, uninstalling the extension removes its local data.

## Project layout

- `src/`: the extension, popup, and activity dashboard.
- `docs/roadmap.md`: build phases and planned commits.
- `docs/testing.md`: checks to run after changes.
- `tests/`: visit, timing, search, and video checks. Run `npm test` with Node.js 20 or newer.

For a real browser check, use Node.js 22 or newer and run `npm run test:browser`.
The script uses Chrome on macOS by default. Set `BROWSELOG_CHROME` to another
Chrome executable if needed. It creates a temporary profile and local HTTPS
test pages. OpenSSL is needed to create the test certificate.

Built with HTML, CSS, JavaScript, and Chrome's extension APIs.

## Progress

- [x] Extension setup and current-page popup
- [x] Local visit history and pause control
- [x] Focused-tab time tracking
- [x] Configurable idle detection
- [x] Timer checkpoints and restart recovery
- [x] Search queries from supported results pages
- [x] Individual YouTube videos and Shorts
- [x] Video playback time
- [x] Activity dashboard and visit label corrections
- [ ] Content categories and personal rules
- [ ] Daily and weekly dashboard
- [ ] Pause, exclusions, deletion, and export

Time tracking will estimate attention; it cannot prove that I was reading,
watching, or accomplishing something. See the [roadmap](docs/roadmap.md).

## License

[MIT](LICENSE)
