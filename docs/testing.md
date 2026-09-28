# Checking a change

Check JavaScript syntax from the repository root:

```bash
node --check src/popup.js
```

## Popup checks in Chrome

- Load `src/` unpacked and check the extension card for errors.
- Open a normal website: the popup should show its hostname and title.
- Click refresh: the button should become usable again after loading.
- Open a browser page: show a helpful message instead of an error.
- Check a long title: text should wrap without overflowing.
- Use Tab and Enter: the refresh button should have visible keyboard focus.
- Confirm that the popup clearly says nothing is being recorded.

Add automated timing tests when the tracker is introduced. The popup alone
does not validate browser-wide tracking, which is not implemented yet.
