# BrowseLog

A Chrome extension I'm building to understand where my browsing time goes.
I started this because hours online can feel productive even when most of
that time goes to unrelated videos and Shorts.

The goal is to separate engaged browsing, estimated video viewing, and idle
time, then show what content I spend time on. Activity history will stay local.

## Current version

Milestone 4 estimates active browsing time for the ten most recent visits. Only
the selected tab in the focused browser window earns time. Timing stops when the
browser loses focus, recording is paused, or the computer becomes idle or locked.
Choose a 30-second, 1-minute, 2-minute, or 5-minute idle threshold in the popup.
Recording starts when installed. Refresh or reopen the popup to update the list.
**Search extraction and video tracking are not implemented yet.**
Navigation inside apps without a full page load is a later milestone.

Time starts after a recorded page load. The first idle threshold interval still
counts, so the number is an estimate of activity rather than proof of attention.
Older visits show their original focused-time value with a separate label, since
those values may include longer idle periods. The unfinished interval may be lost
when Chrome closes or the extension reloads. Restart recovery comes next.

## Install locally

1. Clone this repository or download and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this project's `src` folder.
5. Pin BrowseLog from the extensions menu.
6. Open a website and click the BrowseLog toolbar button.

After editing files, click **Reload** on the extension card, reload open website
tabs, and reopen the popup. This starts a new visit for the updated timer.
No build step, account, or API key is needed.

## Privacy and permissions

The `tabs` permission reads page URLs and titles; `storage` saves settings and
keeps the current timer across background worker suspensions. The `idle`
permission detects computer inactivity and screen lock. Chrome 116 or newer is
required for the idle-state check used on every timing update.
A background worker saves visits in local IndexedDB. Nothing is sent off-device.
Incognito and non-web pages are excluded. URLs lose credentials, query parameters,
and fragments, but paths and titles can still contain personal information.
Existing browser history is not imported. Background page loads count as visits,
not engaged time. Pausing keeps existing records; deletion controls come later.
For now, uninstalling the extension removes its local data.

## Project layout

- `src/`: the extension manifest, popup, and styles.
- `docs/roadmap.md`: build phases and planned commits.
- `docs/testing.md`: checks to run after changes.
- `tests/`: visit filtering and timing checks. Run `npm test` with Node.js 20 or newer.

For a real browser check, use Node.js 22 or newer and run `npm run test:browser`.
The script uses Chrome on macOS by default. Set `BROWSELOG_CHROME` to another
Chrome executable if needed. It creates a temporary profile and local test pages.

Built with HTML, CSS, JavaScript, and Chrome's extension APIs.

## Progress

- [x] Extension setup and current-page popup
- [x] Local visit history and pause control
- [x] Focused-tab time tracking
- [x] Configurable idle detection
- [ ] Restart recovery
- [ ] Search queries and YouTube activity
- [ ] Content categories and personal rules
- [ ] Daily and weekly dashboard
- [ ] Pause, exclusions, deletion, and export

Time tracking will estimate attention; it cannot prove that I was reading,
watching, or accomplishing something. See the [roadmap](docs/roadmap.md).

## License

[MIT](LICENSE)
