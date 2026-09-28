# BrowseLog

A Chrome extension I'm building to understand where my browsing time goes.
I started this because hours online can feel productive even when most of
that time goes to unrelated videos and Shorts.

The goal is to separate engaged browsing, estimated video viewing, and idle
time, then show what content I spend time on. Activity history will stay local.

## Current version

Milestone 1 is a working popup that shows the selected website and page title.
It handles unavailable tabs and browser pages, and has a refresh button.
**It does not record visits, searches, or time yet.**

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

This version uses `activeTab` to read the selected tab when you open the popup.
It displays the hostname and title without saving them or sending them anywhere.
It does not run in the background. Future tracking permissions will be documented
when those features are added.

## Project layout

- `src/`: the extension manifest, popup, and styles.
- `docs/roadmap.md`: build phases and planned commits.
- `docs/testing.md`: checks to run after changes.

Built with HTML, CSS, JavaScript, and Chrome's extension APIs.

## Progress

- [x] Extension setup and current-page popup
- [ ] Local visit history
- [ ] Engaged and idle time tracking
- [ ] Search queries and YouTube activity
- [ ] Content categories and personal rules
- [ ] Daily and weekly dashboard
- [ ] Pause, exclusions, deletion, and export

Time tracking will estimate attention; it cannot prove that I was reading,
watching, or accomplishing something. See the [roadmap](docs/roadmap.md).

## License

[MIT](LICENSE)
