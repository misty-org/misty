# Android Mobile Readiness

Date: 2026-07-09

Focus: Android Studio, Tauri Android, Google Play build readiness, Play-safe metadata, screenshot assets, QA, and security review.

## Current Android State

- Android emulator: `Misty_API_36_arm64`, API 36, 1080 x 1920, density 420.
- Dev launch command: `npm run tauri:android -- --target=android-arm64`.
- Android package/application ID: `com.misty.mobile`.
- Display name: `Misty`.
- Version: `0.1.0`.
- Version code: `1000` (Tauri mapping for `0.1.0`).
- Packaged permissions: `android.permission.INTERNET`, Android's app-private dynamic-receiver permission, and `android.permission.MANAGE_EXTERNAL_STORAGE` for Misty's Android file-manager workflow.
- Android local files: Misty requests Android's **All files access** special app access. This is intentional because the product's core purpose is browsing, organizing, transferring, and syncing user files across local and remote storage. Without this permission, Android 11+ blocks root shared storage and the root `Download` directory from directory grants, which breaks the expected tablet/ChromeOS file-manager UX.
- Deep link scheme: `misty`.
- Release cleartext traffic: disabled through `usesCleartextTraffic=false`.
- Debug cleartext traffic: enabled for the Vite dev server.
- Android auth tokens: AES-256-GCM encrypted with an app-only key in `AndroidKeyStore`; only IV/ciphertext are stored in private preferences. No biometric permission or prompt is used.

## Supported Mobile Scope

- Account sign-in, registration, account state, settings navigation, and sign-out.
- Provider configuration and provider authorization status where credentials are available.
- File browsing, search, file actions, empty/loading/error states, and stale-folder recovery.
- Transfers history, refresh, filters, queue actions, and empty states.
- Settings and privacy/account controls.
- Deep links for files, providers, transfers, account, and settings.

## Intentionally Desktop-Only

- Extensions/plugins, extension catalog, plugin commands, plugin panels, plugin routes, and dynamic extension execution.
- Desktop tray and desktop-only multi-panel extension workflows.
- Desktop web/marketing pages.

## Android Build Commands

Emulator dev run:

```sh
npm run tauri:android -- --target=android-arm64
```

Physical Android device dev run:

```sh
npm run tauri:android:device -- --target=android-arm64
```

To exercise the account flow against a local account server, proxy it through the
development server. This is only for a local debug run; do not put a LAN URL in
an Android release environment:

```sh
MISTY_ANDROID_ACCOUNT_API_PROXY=http://127.0.0.1:8081 \
  npm run tauri:android:device -- --target=android-arm64
```

Before the first device run, enable **Developer options** and **USB debugging** on the Android device, connect it by USB, unlock it, and accept the RSA-debugging prompt. Confirm the connection with:

```sh
$ANDROID_HOME/platform-tools/adb devices
```

The device should show `device`, not `unauthorized`. The command above builds an arm64 debug app, installs it on the connected device, and serves the frontend from the Mac for rapid iteration. Keep the device connected and on the same network; the command's `--host` option makes the Vite server reachable from physical hardware.

The Play-installed build and the locally debug-signed build use the same application ID. Android will reject an in-place debug install because their signing certificates differ, so uninstall the Play test copy from the development device before running the command. Reinstall the Play version afterward through its testing link when needed.

The device command selects one authorized physical device through ADB, refuses to fall back to an emulator, and uses the Mac's LAN address for Vite. When several physical devices are attached, specify the serial shown by `adb devices`:

```sh
npm run tauri:android:device -- --target=android-arm64 --device-id=<serial>
```

## Android Form Factors

- Android phones use Misty's mobile page components.
- Android tablets and ChromeOS windows use the same desktop layout and desktop page components as Misty desktop when both viewport dimensions are at least 600dp.
- Extensions remain unavailable on Android. The Android desktop-style navigation includes Files, Remotes, Transfers, Account, and Settings, but does not expose Extensions.
- Local file access on Android tablets/ChromeOS uses All files access when enabled, mapping common folders such as `Download`, `Documents`, `Pictures`, `Movies`, `Music`, `Recordings`, and `Ringtones` to shared storage paths under Android's external storage root. If access is not enabled, Misty opens Android's special app access settings for the user to grant it.

Debug APK:

```sh
npm run tauri:android:build:debug-apk
```

Release APK:

```sh
npm run tauri:android:build:release-apk
```

Google Play AAB:

```sh
npm run tauri:android:build:release-aab
```

Signing preflight:

```sh
npm run tauri:android:build:preflight
```

## Release Signing

Release APK/AAB builds intentionally fail before the long build when signing inputs are missing. Use an upload key keystore if Google Play App Signing is enabled.

Required variables:

- `MISTY_ANDROID_KEYSTORE_FILE`
- `MISTY_ANDROID_KEYSTORE_PASSWORD`
- `MISTY_ANDROID_KEY_ALIAS`
- `MISTY_ANDROID_KEY_PASSWORD`

Create the ignored `scripts/.signing.env` from `scripts/.signing.env.example` and put only those four values there. The release script loads it automatically, without executing it as shell code, and uses it in preference to inherited shell values. In CI, omit that local file and provide the four variables directly. Do not put signing credentials in `.env.mobile`: it is tracked in this repository, so release credentials placed there are at risk of being committed. Move the four signing entries out and remove them from `.env.mobile` before the next commit.

## Google Play Package

Assemble the local handoff package:

```sh
npm run package:google-play
```

Output: `build/google-play-package`

Validated debug APK: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.

Validated QA-signed release artifacts:

- Four-ABI AAB: `src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab` (bundletool validation passed; 156 MB; SHA-256 `6dd9389344f26934282c03990c832112370a058b000930d2479d0ff4a6ebd2a3`).
- Arm64 release APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk` (installed and cold-launched on API 36; 108 MB; SHA-256 `1f112683e44f8e5b0b894d87dd98596641aea0d3a7a803b982aaeec616e2d12c`).

These two artifacts use a disposable local QA certificate and must not be uploaded. Re-run the release command with the real upload keystore variables to produce the Play artifact.

The Google Play package includes six raw emulator captures, six no-alpha upload-ready screenshots, metadata drafts, review notes, release scripts, validation logs, and the reports in this folder. A signed AAB is added only after the upload keystore variables are supplied.

## Google Play All Files Access Declaration

Misty intentionally declares `MANAGE_EXTERNAL_STORAGE`. This increases Play review risk and requires the Permissions Declaration Form in Play Console.

Suggested declaration framing:

- Category: file management / document management.
- Core functionality: Misty lets users browse, organize, transfer, and sync local files with configured remote storage providers from a tablet or ChromeOS device.
- Why SAF alone is insufficient: Android 11+ prevents directory grants for shared-storage roots and the root `Download` directory. Misty's core local file manager cannot provide desktop-equivalent browsing, transfers, and sync workflows through one-folder-at-a-time grants without breaking expected user workflows.
- Privacy mitigation: Misty uses the permission only for user-initiated local file browsing and file operations. Account tokens remain in Android Keystore-backed storage. Extension/plugin execution is not shipped on Android. The app does not sell files, credentials, or account data, and Android builds avoid purchase or external-payment prompts.

## Remaining External Inputs

- Android upload keystore and passwords.
- Healthy production account API. `https://mistysys.com/api/login` returned Cloudflare 502 during the 2026-07-09 final Android QA pass.
- Production support URL and privacy policy URL.
- Reviewer demo account credentials.
- Reviewer-safe provider OAuth credentials, if full OAuth should be reviewed.
- Play Console access for app creation, Data safety, and track rollout.
