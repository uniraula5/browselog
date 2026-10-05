# BrowseLog

BrowseLog is a browser extension for seeing where my browsing time goes. It
records normal pages, Google/Bing/YouTube searches, and individual YouTube videos
and Shorts. Version 0.3 adds Google sign-in and a dashboard shared across desktop
browsers using the same account.

## What it does

- Counts active time only for the selected tab in the focused window. It stops
  when the computer is idle or locked. Video playback is measured separately.
- Guesses a purpose and topic from titles, then learns from labels I correct.
  Site rules override guesses. The labels cannot tell if I really learned.
- Keeps visits locally while offline and retries cloud sync every two minutes.
  Each device has its own ID, so visits are not duplicated in the dashboard.
- Shows totals, categories, visits, searches, and a device filter. Corrections
  and deletions to synced visits are shared across devices.
- Can pause recording, exclude sites, export JSON, and delete synced history.

## Set up the cloud project

BrowseLog needs your own Firebase project. These are public client identifiers,
not a service-account password.

1. In the [Firebase console](https://console.firebase.google.com/), create a
   project. Enable **Authentication → Google** and create a **Cloud Firestore**
   database in production mode.
2. Run `npm run extension:id`. In [Google Cloud Credentials](https://console.cloud.google.com/apis/credentials),
   create an OAuth client of type **Web application** with authorized redirect
   URI `https://EXTENSION_ID.chromiumapp.org/`. The ID is fixed by
   `scripts/public-key.txt` so Chrome and Arc load the same extension.
3. Copy `config.example.json` to `config.local.json`. Fill in the Firebase
   project ID, its Web API key, and the Web OAuth client ID.
4. Deploy [firestore.rules](firestore.rules) to your Firebase project:

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project YOUR_PROJECT_ID
   ```

5. Build and install:

   ```bash
   npm run build
   ```

   Open `chrome://extensions` (or `arc://extensions`), turn on Developer mode,
   choose **Load unpacked**, and select `dist/`. Repeat on each desktop browser.
   Click **Sign in with Google** in the popup. Gmail inbox access is not requested.

The build inserts your Firebase and OAuth client IDs into `dist/config.js`.
`config.local.json` and `dist/` stay out of Git. Loading
`src/` is only the old local-only development mode; use `dist/` for sync.

## Move older BrowseLog history

The fixed extension ID is different from the older unpacked build's ID. Before
removing the old extension, open its dashboard and click **Export local JSON**.
In the new signed-in dashboard, choose that file under **Move history from the
older BrowseLog extension**. The file imports once, then syncs. Older visits
already present in the same extension can be uploaded with **Upload older local
history** instead. Neither happens automatically.

## Privacy and limits

After sign-in, visits are stored in both local IndexedDB and your Firebase
project. Titles, saved URL paths, supported search terms, video IDs, timing,
and labels reach Firestore. Credentials, URL queries, and fragments are stripped
from saved URLs; search terms are stored separately. Incognito and browser pages
are excluded. Firestore rules allow each signed-in user to read and change only
their own records. Deletion markers remain in Firestore so an offline device
cannot bring a deleted visit back. Local learning examples stay on each device.

Sign-out stops new recording on that browser; it does not delete history. The
dashboard's delete control removes synced visits across devices. Firebase has
[usage quotas](https://firebase.google.com/docs/firestore/pricing), so the
extension batches changed visits instead of uploading every timer update.
Chrome extensions run on desktop browsers, not mobile Chrome. A phone can only
view this data if a separate web dashboard is added later.

## Run checks

```bash
npm test
npm run test:browser
npm run test:sync
```

The browser tests need Chrome for Testing and OpenSSL. Set `BROWSELOG_CHROME`
to the browser executable if Chrome is not in `/Applications`. `test:sync`
uses two temporary browser profiles and a local fake cloud; it cannot verify
real Google sign-in or deployed Firestore rules. Those need the Firebase project
above and a manual sign-in in Chrome and Arc.

The extension is plain JavaScript, HTML, CSS, IndexedDB, and Chrome APIs. The
cloud calls use Firebase's REST APIs, so no package is bundled into the
extension. See [testing notes](docs/testing.md) and [build phases](docs/roadmap.md).

## License

[MIT](LICENSE)
