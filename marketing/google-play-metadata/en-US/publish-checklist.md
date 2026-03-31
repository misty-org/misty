# Google Play Publish Checklist

## Local Build

- Run `npm run build:mobile`.
- Run `npm run security:android:audit`.
- Run `npm run verify:android-release`.
- Run `npm run tauri:android:build:debug-apk` for a local debug APK.
- Run `npm run tauri:android:build:preflight` after setting release signing environment variables.
- Run `npm run tauri:android:build:release-aab` for the Google Play Android App Bundle.
- Confirm `https://mistysys.com/api/login` is healthy and complete a real reviewer-account sign-in; it returned Cloudflare 502 during final local QA.

## Signing

Set these variables for release builds:

- `MISTY_ANDROID_KEYSTORE_FILE`
- `MISTY_ANDROID_KEYSTORE_PASSWORD`
- `MISTY_ANDROID_KEY_ALIAS`
- `MISTY_ANDROID_KEY_PASSWORD`

If Google Play App Signing is enabled, use the upload key keystore. Do not commit keystore files or passwords.

Do not upload the locally validated QA-signed AAB. Rebuild with the real upload key and verify its signer before upload.

## Play Console

- Create or select the Play app for package `com.misty.mobile`.
- Confirm app name `Misty`, category `Productivity`, and default locale `en-US`.
- Upload the signed `.aab`.
- Upload phone screenshots from `marketing/google-play-screenshots/mobile/final/phone-1080x1920/en-US`.
- Add a 512x512 app icon and a 1024x500 feature graphic.
- Paste the metadata from `play-store-listing.json` or `app-info.md`.
- Paste review notes from `review-notes.md` and supply reviewer credentials.
- Complete Data safety using `data-safety-notes.md` as a draft.
- Add production support and privacy policy URLs.
- Confirm there is no pricing, purchase, subscription, upgrade, external-payment, or off-app purchase copy.
- Release first to internal testing, then closed/open/production tracks after smoke testing.

## Final Smoke Before Production

- Fresh install.
- Sign in with reviewer/demo account.
- Provider setup and OAuth callback.
- File browsing.
- Transfer action.
- Settings and sign-out.
- App restart and session clearing.
- Offline/network failure state.
- Deep-link return through `misty://auth/providers` and `misty://account`.
