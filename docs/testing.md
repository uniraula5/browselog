# Checking a change

Check JavaScript syntax from the repository root:

```bash
node --check src/popup.js
npm test
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

Add automated timing tests when the tracker is introduced. Visit counts alone
do not measure engagement. Same-page app navigation is not recorded yet.

## Milestone 2 results

The four automated filtering tests pass. An isolated Chrome for Testing profile
also passed recording, sanitized URLs, popup pause/resume, browser restart
persistence, repeated page loads, newest-first ordering, and the ten-row limit.
The browser checks used temporary local pages, not personal browsing history.
