# Misty Mobile QA Log

Date: 2026-07-09

This log records the current mobile App Store readiness QA evidence. It distinguishes local simulator/package verification from tests that still require Apple signing, TestFlight, reviewer credentials, or live provider credentials.

## Environment

| Field | Value |
| --- | --- |
| Host macOS | 26.5.1, build 25F80 |
| Xcode | 26.5, build 17F42 |
| Simulator used for accepted screenshots | iPhone 17 |
| Simulator OS | iOS 26.5 |
| Simulator state during latest audit | Booted |
| Mobile bundle identifier | `com.misty.mobile` |
| App version/build under validation | `0.1.0` / `1` locally; release scripts propagate `MISTY_IOS_BUILD_NUMBER` into the mobile UI as `VITE_MISTY_IOS_BUILD_NUMBER`. |

## Results

| Area | Device / OS | Result | Evidence / notes |
| --- | --- | --- | --- |
| Mobile TypeScript/Vite build | Local build host | Pass | `npm run build:mobile` is captured in `build/mobile-app-store-package/validation-logs/build-mobile.txt`. |
| Rust/Tauri baseline compile check | Local build host | Pass | `cargo check --manifest-path src-tauri/Cargo.toml` is captured in `validation-logs/cargo-check-tauri.txt`; `cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios-sim` is captured in `validation-logs/cargo-check-tauri-ios-simulator.txt` after mobile native command gating. |
| Rust/Tauri embedded proxy feature check | Local build host | Pass | `cargo check --manifest-path src-tauri/Cargo.toml --features embedded-proxy-go` is captured in `validation-logs/cargo-check-tauri-embedded-proxy.txt`; the host check emits a non-fatal missing host proxy archive warning and exits 0. |
| Release verifier | Local build host | Pass | `npm run verify:mobile-release` now rebuilds the mobile bundle before scanning and currently reports 778 passed, 10 owner-supplied warnings, and 0 failures. |
| Mobile security audit | Local build host | Pass | `npm run security:mobile:audit` now rebuilds the mobile bundle before scanning and found no high-confidence secrets or forbidden production mobile bundle strings. |
| iOS simulator launch | iPhone 17 / iOS 26.5 | Pass for execution | `TAURI_IOS_SIMULATOR_DEVICE="iPhone 17" npm run tauri:ios:simulator:embedded` rebuilt and launched `com.misty.mobile`. The mobile shell now isolates route content and uses an opaque, elevated header layer. `npm run smoke:ios:simulator:ui` launch-settles Misty before navigating each captured route, then waits 30 seconds for WebView compositing; cold deep-link behavior remains covered by the dedicated deep-link smoke helper. All captures use an opaque simulator mask and their manifest requires visual review because `simctl io screenshot` intermittently omits already-rendered WebView layers on this simulator. |
| Fresh install / first launch surface | iPhone 17 / iOS 26.5 | Pass for simulator | `TAURI_IOS_SIMULATOR_DEVICE="iPhone 17" npm run smoke:ios:simulator:fresh-install` uninstalled/reinstalled the current simulator app, launched from a clean container, and wrote `build/mobile-ui-qa/44-smoke-fresh-install-first-launch.png`, `45-smoke-fresh-install-providers.png`, `46-smoke-fresh-install-account-signin.png`, and `ios-fresh-install-smoke-manifest.json`. Visual review confirmed the new first-launch welcome, account-free local browsing action, in-app sign-in action, Remotes, and Account sign-in states. Re-run after final signed build generation. |
| Onboarding / account setup | iPhone 17 / iOS 26.5 | Pass for execution; visual review retained | `build/mobile-ui-qa/44-smoke-fresh-install-first-launch.png` shows the actual first-launch welcome. The rebuilt UI route run covers account sign-in and registration; retain the raw manifest's visual-review flag because this simulator's occasional frame capture layer drop can make an otherwise rendered route look partial. |
| Sign-in with reviewer account | iPhone 17 / iOS 26.5 | Not run | Requires owner-supplied reviewer demo credentials. The App Store owner-field checker records the missing username/password fields. |
| Provider setup UI | iPhone 17 / iOS 26.5 | Pass for visible state | `build/mobile-ui-qa/51-smoke-ui-remotes.png` shows the current Remotes/provider setup surface from the rebuilt app with no diagnostic or purchase-adjacent copy. |
| Live provider OAuth/deep-link return | iPhone 17 / iOS 26.5 | Partial pass | Requires reviewer-safe provider credentials and OAuth configuration for the full provider callback. Simulator route links were verified by `npm run smoke:ios:simulator:deeplinks` for cold-start `misty://providers`, foreground `misty://files`, foreground `misty://providers`, and foreground `misty://open/account/signin`; previous captures also cover foreground `misty://transfers`. Provider OAuth callback return still needs a live credential pass. Deep-link URL scheme `misty` is verified in generated iOS metadata. |
| File browsing UI | iPhone 17 / iOS 26.5 | Pass | `build/mobile-ui-qa/50-smoke-ui-files.png` shows the real On My iPhone folder list. Mobile Files action sheets no longer expose desktop-style Open With app selection or folder upload actions; verifier/security scans keep those strings out of the production mobile bundle. |
| Transfers UI | iPhone 17 / iOS 26.5 | Pass | `build/mobile-ui-qa/52-smoke-ui-transfers.png` verifies the empty Transfers state instead of an indefinite skeleton, with empty filter chrome hidden until there is history and next-step actions for Files and Remotes. Final App Store screenshots remain paused pending UI approval. |
| Upload/download/sync with live provider | iPhone 17 / iOS 26.5 | Not run | Requires signed device/TestFlight build and live provider credentials. Local transfer UI and native transfer recovery logging are covered by verifier/security scans. |
| Settings/account management | iPhone 17 / iOS 26.5 | Pass for execution; visual review retained | The rebuilt UI route run covers signed-out Account, auth, and Settings surfaces, and the release verifier checks Account static rows and Settings navigation. Keep the raw capture manifest's visual-review flag until a final human simulator review; some `simctl` frames intermittently omit WebView layers without a corresponding route/navigation failure. |
| Touch targets / visible accessibility | iPhone 17 / iOS 26.5 | Pass for inspected surfaces | Mobile shell, Files, Remotes, Transfers, Account, and Settings controls were normalized to at least 44-point interactive targets where they are not already wrapped by a larger tappable row. Settings switches now expose one labeled `role="switch"` control rather than a button nested inside a label. Full VoiceOver, Dynamic Type, contrast instrumentation, and switch-control testing still require a real-device accessibility pass. |
| Sign-out/session clearing | iPhone 17 / iOS 26.5 | Not run end to end | Requires a signed-in reviewer/demo account. Keychain-backed token storage and sign-out behavior are reviewed in the security notes; final smoke should verify session clearing with real credentials. |
| Offline/network failure UX | iPhone 17 / iOS 26.5 | Not run end to end | Requires controlled network/provider test state. Production mobile bundle scans verify no debug/private API hosts are shipped. |
| App restart persistence | iPhone 17 / iOS 26.5 | Partial pass | Fresh-install first launch and mobile route memory are covered by simulator smoke/source checks; Account/Settings surfaces and top-level Home/Changelog/SignIn/Register mobile redirects are covered by source/verifier checks. Full restart after sign-in requires reviewer credentials. |
| Extension/plugin absence | Mobile production bundle/native source/archive | Pass | Release verifier scans production `dist` for extension UI/action strings, native source for desktop-only plugin command service/runtime and handler registration, and the refreshed iOS archive binary for plugin install/scan/enable/uninstall command names, plugin command-table names, plugin loader symbols, and `libloading`. |
| Commerce/App Review safety | Mobile production bundle and metadata | Pass locally | Release verifier scans mobile `dist` and metadata for pricing, purchase, subscription, upgrade, external-payment language, and browser-preview account bypass strings. |
| Submission status report | Local build host | Pass with external blockers | `npm run app-store:submission-status` writes `build/mobile-submission-status.json` and `.md`; strict mode remains intentionally non-zero until owner fields, no-watermark screenshots, Apple signing, a signed archive, and TestFlight/live-provider evidence are supplied. External QA is recorded in `build/mobile-external-qa-evidence.json` using `marketing/app-store-metadata/en-US/external-qa-evidence.example.json`. |
| iOS archive metadata validation | Local archive | Pass for unsigned local archive | `npm run tauri:ios:archive:validate` verifies bundle ID, build/version, URL scheme, minimum OS, iPhone-only portrait metadata, local-network purpose, export compliance, and privacy manifest. |
| Real device debug run | Physical iPhone | Blocked | Requires Apple Development team/profile and registered device. `npm run tauri:ios:device:preflight` currently fails clearly because no Apple team env var is set. |
| TestFlight/App Store archive upload | App Store Connect | Blocked | Requires Apple signing/provisioning/App Store Connect credentials. `npm run tauri:ios:archive:preflight` currently fails clearly because no Apple team env var is set. |
| Watermark-free App Store screenshots | Local generated assets | Paused pending UI approval | Existing no-watermark screenshots remain in `marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/designed-fallback`, but final App Store screenshot regeneration is intentionally paused until the mobile UI is approved. The ButterKit draft remains quarantined because it is watermarked. |

## Final Smoke Still Required

- Run real-device debug smoke after Apple Development signing is available.
- Run TestFlight install/update smoke after a signed archive is uploaded.
- Verify reviewer demo sign-in, sign-out/session clearing, signed-build app restart, and account state with owner-supplied credentials.
- Verify live provider OAuth/deep-link return and at least one upload/download/sync action with reviewer-safe provider credentials.
- Generate the final Xcode privacy report from the signed archive and reconcile it with the privacy-label draft.
