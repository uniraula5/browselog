# BrowseLog

BrowseLog is a Chrome extension I built to see where my browsing time goes. It
records visits to normal websites, supported searches, and individual YouTube
videos and Shorts. Everything stays in the browser's local storage.

## What version 0.1 does

- Records page visits across tabs, including background tabs. Only the selected
  tab in the focused Chrome window earns active time.
- Stops active time when Chrome loses focus or the computer is idle or locked.
  The idle threshold is adjustable from 30 seconds to 5 minutes.
- Records Google, Bing, and YouTube search terms. It follows YouTube searches,
  videos, and Shorts when the URL changes without a page reload.
- Estimates YouTube playback time while a video plays in the visible, focused
  tab. Playback can continue during computer idle, but stops on screen lock.
- Suggests format, topic, and purpose labels from simple keywords. Unknown
  content stays unknown. You can correct labels on individual visits or add a
  site rule for future visits.
- Shows today, last seven days, and all-time summaries, breakdowns, and a
  filterable activity timeline. Engaged time counts overlapping active and
  playback time once.
- Lets you pause recording, exclude sites, delete visits or all history, and
  export visits and settings as JSON.

The labels are guesses. They cannot tell whether a video was useful or whether
I was actually paying attention.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome 120 or newer.
3. Turn on **Developer mode**, then click **Load unpacked**.
4. Select the repository's `src` folder and pin BrowseLog.
5. Open the toolbar popup to see recent activity, then choose **Open activity
   dashboard** for summaries and controls.

There is no build step, account, API key, or cloud service. After changing the
code, use **Reload** on the extension card.

## How the timing works

The background worker tracks the active tab and saves a checkpoint about every
30 seconds. It restores open tabs after a browser restart without counting the
time Chrome was closed. Long delayed checkpoints are capped at one minute.
A small script on YouTube pages reports short playing intervals; the worker
accepts them only for the selected, visible tab. Active and playback time are
stored separately, along with their overlap.

Time is an estimate. The first idle-threshold interval counts as active, and
the last few seconds before Chrome closes may be lost. A video playing while
you are away can still count as playback if Chrome remains focused and the
computer is not locked.

## Privacy

BrowseLog does not send activity anywhere. It excludes incognito and browser
pages. Saved URLs lose credentials, query parameters, and fragments, but paths
and titles may still be personal. Supported search terms (up to 500 characters)
and YouTube video IDs are stored separately. An export contains these details.
Excluding a site stops future recording for that site and its subdomains; delete
older visits separately if needed.

The extension uses `tabs` for URLs and titles, `storage` for settings and the
current timer, `idle` for computer inactivity, `alarms` for checkpoints, and
`webNavigation` for same-page URL changes. Its YouTube content script reads
video playing state; it does not read the video itself.

## Run checks

```bash
npm test
npm run test:browser
```

Unit tests need Node.js 20 or newer. The browser test needs Node.js 22 or newer,
Chrome, and OpenSSL. It uses a temporary Chrome profile and local HTTPS pages.
On macOS it looks for Chrome in `/Applications`; set `BROWSELOG_CHROME` to another
Chrome executable if needed.

`src/` contains the extension, `tests/` contains unit and browser checks, and
`docs/roadmap.md` records the build phases. Built with HTML, CSS, JavaScript,
Chrome extension APIs, and IndexedDB.

## Limits and next ideas

Existing Chrome history is not imported. Search-term extraction covers Google,
Bing, and YouTube; other search engines appear as ordinary visits. Other sites'
same-page navigation is not tracked yet. Keyword labels are intentionally simple;
manual corrections and site rules are available when they get something wrong.

See [testing notes](docs/testing.md) for checks that still need a real desktop,
such as screen lock and sleep.

## License

[MIT](LICENSE)
