# Journal fonts and app-only updates

Journal 1.1.0-beta.2 keeps the common drawing fonts in its desktop component. The 209 Xiaolai CJK subsets are separate, immutable WOFF2 files. English-only drawings need no extra download. Drawing changes (including collaboration updates), previews and exports load only matching Unicode subsets.

The package uses the existing public SDK 0.1.0. Font requests go through `network.fetch` to `https://apps.mistysys.com/official-app-assets/journal/<sha256>.woff2`. Every download and persistent cache read is checked against the SHA-256 embedded in the signed component before it reaches FontFace. A bounded 768 KiB local cache is best effort; in-memory requests are deduplicated. Cache entries can be evicted and downloaded again. Each font fits the host's 128 KiB response limit. No font worker, external browser request, private host API, or new desktop build is required.

Journal permission version 4 adds network access and reuses its existing local storage permission. Existing users must approve the added permission through the normal app update flow; the first native request also uses the host's origin approval. A failed font download keeps fallback text visible and reports the problem. Exports require the exact verified fonts and fail rather than embedding an unverified substitute. Reopening the drawing retries a failed font request. Closing Journal removes its owned fonts and prevents late cache writes.

## Prepare

Use clean committed checkouts of Misty and misty-apps, with their pinned SDK archives installed. Load `MISTY_OFFICIAL_APP_SIGNING_PRIVATE_KEY` securely into the child process from the local release key. Do not print or commit the key.

```
MISTY_APPS_ROOT=/path/to/misty-apps node scripts/release/prepare-app-update.mjs \
  journal /path/to/current/official-app-catalog.json /path/to/new-output-directory
```

The source catalog supplies the new Journal version and permissions. The baseline supplies every other app unchanged. The command builds only Journal, verifies its release signature, and creates:

- `upload/official-apps/journal/1.1.0-beta.2/desktop.zip`
- `upload/official-app-assets/journal/<sha256>.woff2` and the Xiaolai license
- `official-app-catalog.json`, generated Go `catalog.go`, a release manifest and `SHA256SUMS`

This does not publish anything. The normal full beta preparation also retains optional assets, including assets from the prior release.

## Upload and activate

Upload the **contents** of `upload/` to the R2 bucket connected to `apps.mistysys.com`, preserving both top-level directory names. Do not add an `upload/` prefix. Serve `.woff2` as `font/woff2`; use `Cache-Control: public, max-age=31536000, immutable` for hash-named fonts and versioned ZIPs. Browser CORS access is unnecessary because the native SDK downloads them.

Fetch the uploaded ZIP and every font URL and compare SHA-256 against the prepared manifest. Existing versioned objects must remain available. Only after those public checks pass should the prepared Go catalog be deployed with the existing Go deployment procedure. No desktop updater feed changes are needed. Keep the previous catalog for rollback; never replace a published ZIP at the same version path.

If the domain returns 404 or the upload credentials do not work, leave the current Go catalog running and hand over the upload folder. A prepared package is not a live app update.

## Focused verification

Run the font loader tests (corrupt downloads/cache, deduplication, lifecycle, Unicode selection), the real Excalidraw adapter test and type checking. Build Journal with the component boundary checks. `scripts/sdk-journal-render-run.mjs` exercises English with zero font downloads, subsequent multilingual text, PNG/SVG clipboard, file export and cleanup using real Chromium rendering with SDK device/server doubles. `MISTY_PLAYWRIGHT_MODULE` and optional `MISTY_CHROMIUM_EXECUTABLE` can select the local runtime.

This browser probe does not replace a real macOS installation and native permission approval run.
