# Android Mobile QA Log

Date: 2026-07-09

Device under test: Android emulator `Misty_API_36_arm64`, model `sdk_gphone64_arm64`, Android 16 / API 36, 1080 x 1920.

| Area | Status | Evidence / notes |
| --- | --- | --- |
| Android emulator dev launch | Pass | `npm run tauri:android -- --target=android-arm64` installed and launched `MainActivity` on `emulator-5554`. |
| Fresh install / welcome | Pass | Cleared `com.misty.mobile` app data, cold-launched the rebuilt APK, and captured the actual first-launch welcome UI. Corrected stale iPhone copy to device-neutral Android-safe language. |
| Android package identity | Pass | Packaged APK reports `com.misty.mobile`, version `0.1.0` / code `1000`, minSdk 28, targetSdk 36, and arm64 native code. |
| Debug APK | Pass | `npm run tauri:android:build:debug-apk` produced `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`; install and cold launch passed. |
| Release APK | Pass with QA signer | Arm64 release APK built, verified as non-debuggable/minimally permissioned, installed, and cold-launched. SHA-256: `1f112683e44f8e5b0b894d87dd98596641aea0d3a7a803b982aaeec616e2d12c`. |
| Release AAB | Pass with QA signer | Four-ABI optimized AAB built and passed bundletool validation. SHA-256: `6dd9389344f26934282c03990c832112370a058b000930d2479d0ff4a6ebd2a3`. Rebuild with the real upload key before Play submission. |
| Files | Pass | On-device Documents browsing, populated sample folders, refresh, and stale unavailable-folder recovery verified; raw screenshot saved as `raw/phone/01-files.png`. |
| Remotes/provider setup | Pass with credential boundary | Provider setup/empty UI and navigation verified; raw screenshot saved as `raw/phone/02-remotes.png`. Live OAuth still requires reviewer-safe credentials. |
| Transfers | Pass with credential boundary | Transfer status/empty UI and navigation verified; raw screenshot saved as `raw/phone/03-transfers.png`. A live remote transfer requires provider credentials. |
| Settings/security/account | Pass | Appearance, account, privacy, notification, and device setting surfaces verified; raw screenshot saved as `raw/phone/04-settings.png`. |
| Account sign-in/state | Pass with external-service boundary | Sign-in/account UI and navigation verified; raw screenshot saved as `raw/phone/05-account.png`. The configured `https://mistysys.com/api/login` endpoint returned Cloudflare 502 during final QA, so real session persistence/sign-out remains externally blocked. |
| Deep links | Pass | Live Android intents routed `misty://auth/providers` to `/providers`, `misty://account/signin` to `/account/signin`, and `misty://open/settings` to `/account/settings`. |
| Offline/error state | Pass | Relaunched through an unreachable Android system proxy and submitted a dummy sign-in; the UI displayed `Could not reach Misty server ... Failed to fetch`. Proxy settings were deleted and the app cold-launched cleanly afterward. |
| Secure token storage | Pass | API 36 instrumentation test `tokenIsEncryptedRoundTripsAndCanBeRemoved` passed 1/1: AES-GCM round trip, no plaintext in private preferences, and deletion. |
| Packaged permissions | Pass with Play review risk | Android now intentionally declares `MANAGE_EXTERNAL_STORAGE` in addition to `INTERNET` so Misty can provide file-manager grade local browsing on Android tablets/ChromeOS. Requires Play Console All files access declaration and approval. |
| All files access flow | Pass on Lenovo tablet | 2026-07-10 physical-device smoke test on Lenovo TB361FU / Android 16: tapping `Downloads` opened Android's Misty-specific **All files access** settings screen. After enabling the switch and returning to Misty, `Downloads` opened directly as `/storage/emulated/0/Download` through normal filesystem browsing. |
| Extension/plugin absence | Pass | Mobile bundle scans and route/native gating checks passed; extension UI and dynamic extension execution are absent from Android. |
| Commerce/Play policy copy | Pass | Mobile bundle and metadata scans found no purchase, pricing, subscription, upgrade, or external-payment language and no fake URL placeholders. |
| Security/readiness gates | Pass | `security:android:audit`: 19 passes, 0 warnings/findings. `verify:android-release`: 85 passes, 0 warnings/errors across all six raw/final screenshots and the newest APK. |
| Play-uploadable AAB | Blocked by external input | The release path is proven with a disposable `/tmp` QA key; final upload requires the real Android upload keystore env vars. |
| Live provider OAuth | Blocked by external input | Requires reviewer-safe provider credentials. |
| Live account workflow | Blocked by external service/input | Restore the production account API from its current Cloudflare 502 state, then supply reviewer demo credentials. |

Update this log after each emulator smoke pass and keep failures until fixed or explicitly blocked by missing external credentials.
