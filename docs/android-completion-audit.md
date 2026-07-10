# Android / Google Play Completion Audit

Date: 2026-07-09

## Requirement Evidence

| Area | Status | Authoritative evidence |
| --- | --- | --- |
| Android Studio / emulator | Complete locally | Generated project opened at `src-tauri/gen/android`; API 36 AVD installed debug and release APKs and cold-launched `com.misty.mobile/.MainActivity`. |
| Screenshots | Complete | Six actual-app raw captures and six 1080 x 1920 RGB/no-alpha Play exports cover welcome, Files, Remotes, Transfers, Settings, and Account. `verify:android-release` validates every raw/final image. |
| Butterkit design | Complete with export limitation | Butterkit document `untitled--7290922020754050731` contains six artboards with the six final compositions. Watermarked Butterkit exports are retained separately; only clean files in `final/phone-1080x1920/en-US` are submission assets. |
| Mobile parity/polish | Complete for credential-free core UI | All requested page folders retain desktop/mobile separation. Android-reachable flows, empty/loading/error surfaces, first launch, navigation, stale path recovery, and deep links were exercised. Live account/provider/transfer flows remain externally blocked below. |
| Extension/plugin exclusion | Complete | Mobile routes redirect extension/changelog/desktop-only pages; native extension services are desktop-gated; mobile bundle scans find no extension catalog/install UI or debug panels. |
| Android build | Complete locally | Debug APK builds. QA-signed arm64 release APK installs/launches. QA-signed four-ABI release AAB passes bundletool validation. Missing real signing inputs fail before the long build. |
| Release scripts/docs | Complete | Dedicated Android debug APK, release APK, release AAB, preflight, security, verification, screenshot, and package scripts are documented in `android-mobile-readiness.md`. |
| Embedded proxy/rclone | Complete locally | Embedded proxy builds and links for arm64-v8a, armeabi-v7a, x86, and x86_64. Android app-private data/cache/config paths initialize on fresh install; no host subprocess path is required. Live OAuth/provider transfer needs credentials. |
| Play policy safety | Complete locally | App bundle and metadata scans find no purchase, pricing, subscription, upgrade, external-payment, fake URL, or mobile extension language. |
| Security/privacy | Complete locally | 19 automated security passes, no warnings/findings; release cleartext disabled; minimal merged permissions; Android Keystore AES-GCM token storage passes on-device instrumentation. |
| QA | Complete locally with external boundaries | Fresh install, debug/release cold launch, Files/Remotes/Transfers/Settings/Account UI, deep links, offline account error, package identity, signing, permissions, and secure storage passed on API 36. |
| Metadata/review package | Complete as a draft | Listing, review notes, Data safety notes, screenshot manifest, publish checklist, and package manifest are assembled under `build/google-play-package`. No fake support/privacy URL values are inserted. |
| Google Play submission | Blocked externally | Requires the real upload key, healthy account API, production support/privacy URLs, reviewer/demo/provider credentials, Play Console access, final Data safety answers, and track upload/review. |

## Fixed Android Bugs

- Android first run now resolves an app-private Misty data root instead of failing on unavailable desktop home-directory assumptions (`src-tauri/src/services/paths.rs`, `environment.rs`, `runtime.rs`, `lib.rs`).
- Files resets stale desktop/iOS paths, uses device-neutral labels, and recovers to the Android root (`src/pages/Files/mobile/index.tsx`).
- First-launch and Account copy no longer says iPhone on Android (`src/pages/Files/mobile/MobileFirstLaunchWelcome.tsx`, `src/pages/Account/mobile/index.tsx`).
- Remotes empty state no longer bleeds/overflows on the emulator (`src/pages/Providers/mobile/index.tsx`).
- The alpha biometric keystore implementation was replaced with repo-owned Android Keystore AES-GCM storage without biometric prompts, premature completion, or native debug logging (`src-tauri/vendor/tauri-plugin-keystore`).
- Android build target parsing now passes arm64 through to Tauri instead of unexpectedly compiling armv7 without a matching proxy (`scripts/build-android-release.mjs`).
- Android package ID/namespace, signing, cleartext policy, SDK levels, and release failure messages are explicit (`src-tauri/tauri.android.conf.json`, `src-tauri/gen/android/app/build.gradle.kts`).

## Remaining Manual Steps

1. Restore `https://mistysys.com/api/login`; it returned Cloudflare 502 during final QA.
2. Supply a reviewer/demo account and reviewer-safe provider OAuth credentials; run real sign-in, restart/session restore, provider callback, transfer, and sign-out tests.
3. Supply production support and privacy-policy URLs plus the account-deletion process; finalize Data safety answers against production backend behavior.
4. Set the four `MISTY_ANDROID_*` signing variables to the real upload key and run `npm run tauri:android:build:release-aab`.
5. Verify the rebuilt AAB signer and bundletool output, then upload it with the six clean screenshots to an internal Play track before production rollout.
