# BrowseLog

A Chrome extension I'm building to understand where my browsing time goes.
I started this because hours online can feel productive even when most of
that time goes to unrelated videos and Shorts.

The goal is to separate engaged browsing, estimated video viewing, and idle
time, then show what content I spend time on. Activity history will stay local.

## Current version

Milestone 2 records completed page loads locally and shows the ten most recent
visits with their titles, sites, and timestamps. Recording starts when installed;
use the popup to pause or resume it. Refresh or reopen the popup to update the list.
**Search extraction, video tracking, and time tracking are not implemented yet.**
Navigation inside apps without a full page load is a later milestone.

## Install locally

1. Clone this repository or download and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this project's `src` folder.
5. Pin BrowseLog from the extensions menu.
6. Open a website and click the BrowseLog toolbar button.

After editing files, click **Reload** on the extension card and reopen the popup.
No build step, account, or API key is needed.

## Privacy and permissions

The `tabs` permission reads page URLs and titles; `storage` saves the pause setting.
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
- `tests/`: visit filtering checks. Run `npm test` with Node.js 20 or newer.

Built with HTML, CSS, JavaScript, and Chrome's extension APIs.

## Progress

- [x] Extension setup and current-page popup
- [x] Local visit history and pause control
- [ ] Engaged and idle time tracking
- [ ] Search queries and YouTube activity
- [ ] Content categories and personal rules
- [ ] Daily and weekly dashboard
- [ ] Pause, exclusions, deletion, and export

Time tracking will estimate attention; it cannot prove that I was reading,
watching, or accomplishing something. See the [roadmap](docs/roadmap.md).

## License

[MIT](LICENSE)
