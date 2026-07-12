# Misty Mobile App Store Readiness

Date: 2026-07-09
Focus: iOS mobile readiness, simulator validation, App Store-safe packaging, and release handoff.

Completion audit: `docs/mobile-app-store-completion-audit.md`
Standalone QA log: `docs/mobile-qa-log.md`

## Current State

Misty mobile now builds and launches on the iOS simulator with the mobile bundle identifier `com.misty.mobile`. The iOS simulator smoke pass used iPhone 17 on iOS 26.5. A Tauri iOS archive was produced locally at `src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive`.

The iOS target is intentionally iPhone-only (`TARGETED_DEVICE_FAMILY=1`, archive `UIDeviceFamily=[1]`) so the current App Store package only includes iPhone screenshots. If iPad support is enabled later, add iPad-specific QA, layout polish, metadata, and screenshots before upload.

The App Store submission package is locally prepared except for external account/signing items and a watermark-free Butterkit export:

- Xcode/App Store Connect credentials must be repaired in Xcode before upload/export. Xcode reported invalid credentials for the local Apple account token.
- Butterkit MCP is reachable and accepted captures are staged, but direct Butterkit exports currently include a Butterkit watermark and were generated before final UI approval, so they must not be uploaded.
- Production support URL, privacy policy URL, and reviewer demo credentials must be supplied by the account owner before submission.

## Mobile Scope

Supported on mobile:

- Account sign-in, registration, account state, settings navigation, and sign-out.
- A first-launch welcome with account-free local browsing and an in-app sign-in path.
- Provider configuration and provider authorization status.
- File browsing, search, file actions, empty states, loading states, and error states.
- Transfers history, refresh, filters, pause/resume/cancel/retry/remove actions where the backend reports them as available.
- Settings and privacy/account controls.
- Deep links for files, providers, transfers, account, and settings; diagnostics links redirect to Settings on mobile instead of showing a desktop-only fallback.

Intentionally desktop-only:

- Extensions/plugins, extension catalog, native plugin commands, plugin panels, plugin tabs, desktop tray, desktop multi-panel extension workflows, and desktop web/marketing pages.
- Mac notarization is handled by a separate script and is not part of the iOS release path.

## App Review Safety

Mobile UI changes made:

- Removed mobile settings subscription wording and unfinished privacy/terms rows.
- Reworded account mobile "license/plan" UI into neutral account access/status language.
- iOS local network permission text now explains local secure runtime services rather than development/local proxy wording.
- Mobile routes continue to exclude the Extensions route and the mobile nav exposes only Files, Remotes, Transfers, Account, and Settings-related screens.
- Mobile builds now compile mobile page entrypoints without importing desktop page variants, and the mobile bundle no longer includes the desktop extension catalog UI strings.
- Home, Changelog, SignIn, and Register now have mobile redirect entrypoints; top-level mobile SignIn/Register routes land in the real Account sign-in/register flows.
- Mobile native commands for extension/plugin operations are inert stubs, and the native plugin command service is excluded from mobile runtime construction.
- The mobile Files action sheet no longer exposes the unfinished Mika assistant surface.
- The mobile Files action sheets no longer expose desktop-style Open With app selection or folder upload actions that depend on unsupported iOS picker behavior.
- Mobile diagnostics routes are hidden from navigation and redirect to Settings so App Store builds do not expose desktop-only placeholder UI.
- A clean install now opens a focused Misty welcome state while preserving local browsing without account creation.

Remaining review notes for the submitter:

- Do not add pricing, subscription, upgrade, external purchase, or off-app account-purchase copy to the iOS binary or App Store metadata.
- Supply real production support and privacy policy URLs in App Store Connect.

## Build and Release Commands

Simulator dev run:

```sh
APPLE_DEVELOPMENT_TEAM=<team-id> TAURI_IOS_SIMULATOR_DEVICE="iPhone 17" npm run tauri:ios:simulator:embedded
```

Device dev run:

```sh
APPLE_DEVELOPMENT_TEAM=<team-id> npm run tauri:ios:device:embedded
```

Device dev preflight without building:

```sh
APPLE_DEVELOPMENT_TEAM=<team-id> npm run tauri:ios:device:preflight
```

App Store/TestFlight archive:

```sh
MISTY_IOS_DEVELOPMENT_TEAM=<team-id> MISTY_IOS_BUILD_NUMBER=1 npm run tauri:ios:archive:app-store
```

`APPLE_DEVELOPMENT_TEAM=<team-id>` is also accepted for consistency with simulator/device development commands.

The device and archive scripts fail before the long build if the Team ID format, Xcode command-line tools, or local signing identity are missing. The simulator, device, and archive scripts also pass `MISTY_IOS_BUILD_NUMBER` through to the mobile UI as `VITE_MISTY_IOS_BUILD_NUMBER`, and the archive script validates the App Store build number against the generated archive. For CI environments that install signing identities in a separate step, set `MISTY_IOS_SKIP_SIGNING_PREFLIGHT=1` only after confirming the required Apple Development or Apple Distribution identity is available to `xcodebuild`.

Signed archive preflight without building:

```sh
MISTY_IOS_DEVELOPMENT_TEAM=<team-id> MISTY_IOS_BUILD_NUMBER=<build> npm run tauri:ios:archive:preflight
```

Validate the current local iOS archive package:

```sh
npm run tauri:ios:archive:validate
```

Flatten iOS app icons before regenerating archives if icon sources change:

```sh
npm run icons:ios:flatten
```

Optional export method override:

```sh
MISTY_IOS_EXPORT_METHOD=release-testing MISTY_IOS_DEVELOPMENT_TEAM=<team-id> npm run tauri:ios:archive:app-store
```

Mac notarization remains separate:

```sh
APPLE_ID=<apple-id> APPLE_TEAM_ID=<team-id> APPLE_APP_SPECIFIC_PASSWORD=<password> npm run notarize:mac -- path/to/Misty.dmg
```

Local release package verifier. This rebuilds the mobile web bundle before scanning `dist`, so it remains valid even if a desktop build ran last:

```sh
npm run verify:mobile-release
```

Repeatable mobile security audit. This also rebuilds the mobile web bundle before scanning `dist`:

```sh
npm run security:mobile:audit
```

Owner-supplied App Store Connect field check:

```sh
npm run app-store:owner-fields:check
npm run app-store:owner-fields:strict
```

Use `marketing/app-store-metadata/en-US/app-store-owner-fields.env.example` as the local-only template for the final support/privacy URLs, App Review contact fields, and reviewer credentials. The strict check accepts environment variables so reviewer credentials do not need to be committed, and rejects missing, sample, or local support/privacy URLs.

Machine-readable submission status:

```sh
npm run app-store:submission-status
npm run app-store:submission-status:strict
```

The non-strict command writes `build/mobile-submission-status.json` and `.md`. Strict mode is the final upload gate and remains non-zero while required owner, signing, screenshot, archive, or external QA evidence is missing. Record completed real-device/TestFlight checks in `build/mobile-external-qa-evidence.json` using `marketing/app-store-metadata/en-US/external-qa-evidence.example.json`; set `MISTY_IOS_EXTERNAL_QA_EVIDENCE_PATH` if the evidence file lives elsewhere.

Refresh simulator QA after installing the current build:

```sh
TAURI_IOS_SIMULATOR_DEVICE="iPhone 17" npm run smoke:ios:simulator:fresh-install
TAURI_IOS_SIMULATOR_DEVICE="iPhone 17" npm run smoke:ios:simulator:ui
TAURI_IOS_SIMULATOR_DEVICE="iPhone 17" npm run smoke:ios:simulator:deeplinks
```

Assemble the local App Store handoff package:

```sh
npm run package:mobile-app-store
```

Output: `build/mobile-app-store-package`

The package command runs `npm run build:mobile` before verification so the release scans always inspect a fresh mobile `dist` bundle, even if a desktop build was run earlier in the same worktree.

## iOS Configuration

- Product name: `Misty`
- Bundle identifier: `com.misty.mobile`
- Version: `0.1.0`
- Build number: `1`
- Deployment target: iOS 15.0
- Target device family: iPhone only (`1`)
- iPhone orientation: portrait only, matching the verified simulator QA and App Store screenshot set
- URL scheme: `misty`
- Local network permission string: "Misty uses local secure runtime services on this device to browse and transfer files."
- App Transport Security: local networking allowed for the embedded local runtime.
- Export compliance Info.plist key: `ITSAppUsesNonExemptEncryption=false`; revisit this if Misty adds non-exempt or proprietary encryption.
- Privacy manifest: `src-tauri/gen/apple/misty-desktop_iOS/PrivacyInfo.xcprivacy` is included in the generated Xcode Resources phase and the rebuilt simulator archive app bundle.
- App icons: generated iOS icon catalog entries are present at the expected pixel sizes, flattened without alpha channels, and compiled into the current simulator archive.

## Screenshots

Raw simulator captures:

- `marketing/app-store-screenshots/mobile/raw/iphone-17`
- Accepted clean set: `marketing/app-store-screenshots/mobile/raw/accepted`

Fallback iPhone exports:

- `marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/fallback-direct-resize`
- Designed local fallback set: `marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/designed-fallback`
- Optional 6.5-inch direct resized set: `marketing/app-store-screenshots/mobile/final/iphone-6-5/en-US/fallback-direct-resize`
- Optional 6.5-inch designed set: `marketing/app-store-screenshots/mobile/final/iphone-6-5/en-US/designed-fallback`
- Rebuild designed fallbacks with `npm run screenshots:mobile:design`.

Butterkit status:

- Butterkit MCP was attempted three times, including once after MCP tools became visible in Codex.
- Butterkit MCP was retried after the mobile hardening pass and remained unreachable.
- Result after staging retry: Butterkit MCP became reachable, templates/artboards were available, and a draft export was produced.
- Accepted captures can be staged into Butterkit's MCP import folder with `npm run screenshots:mobile:stage-butterkit`.
- Direct Butterkit PNG exports include a `Made with ButterKit` watermark and were generated before final UI approval, so they are quarantined in `final/iphone-6-9/en-US/butterkit-watermarked-draft` and must not be uploaded.
- Required manual action: approve the mobile UI, then regenerate final no-watermark App Store screenshots from the approved simulator states.

## QA Log

The standalone workflow-level QA log is `docs/mobile-qa-log.md`; the table below summarizes the current package and release gates.

| Check | Result | Notes |
| --- | --- | --- |
| TypeScript/mobile Vite build | Pass | `npm run build:mobile` passed after mobile Transfers, account copy, and Mika mobile-surface removal. |
| Desktop Vite regression build | Pass | `npm run build:desktop` passed after mobile-build import splitting. |
| Rust/Tauri baseline check | Pass | `cargo check --manifest-path src-tauri/Cargo.toml` passed and is now captured in the handoff package as `validation-logs/cargo-check-tauri.txt`; `cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios-sim` is captured as `validation-logs/cargo-check-tauri-ios-simulator.txt` after mobile native command gating. |
| Rust/Tauri embedded storage feature check | Pass | Build with `npm run service:archive`, then check `src-tauri/Cargo.toml` with `--features embedded-storage-go`. |
| iOS simulator build/run | Pass | iPhone 17, iOS 26.5 launched `com.misty.mobile`. Opaque fresh-install evidence is in `44-smoke-fresh-install-first-launch.png`, `45-smoke-fresh-install-providers.png`, and `46-smoke-fresh-install-account-signin.png`. Complete shipped-screen evidence is in `50-smoke-ui-files.png` through `56-smoke-ui-settings.png` plus `ios-mobile-ui-smoke-manifest.json`. Repeatable deep-link evidence is in `40-smoke-cold-providers.png` through `43-smoke-foreground-account-signin.png`. |
| iPhone orientation metadata | Pass | Generated Xcode config, generated Info.plist, and current archive are portrait-only for iPhone and omit iPad-specific orientation metadata to avoid advertising unverified layout support. |
| iOS archive build number | Pass | Simulator archive app and generated Info.plist both verified `CFBundleVersion=1`; release scripts now propagate the same build number into the mobile Settings/About UI. |
| iOS privacy manifest/export compliance | Pass | Rebuilt simulator archive contains `PrivacyInfo.xcprivacy`; archive Info.plist has `ITSAppUsesNonExemptEncryption=false`; validators check no tracking domains, all declared collected-data types, and all required-reason API categories/reason codes. |
| iOS archive package validation | Pass | `npm run tauri:ios:archive:validate` validates bundle ID, build/version, URL scheme, ATS/local-network purpose, minimum OS, export compliance, and privacy manifest. |
| iOS app icon catalog/archive | Pass | `npm run icons:ios:flatten` removed alpha channels; verifier checks source icon dimensions/opacity, 1024 marketing icon, archive `Assets.car`, and archive icon outputs. |
| App Store handoff package | Pass | `npm run package:mobile-app-store` runs a fresh mobile build, validates release artifacts, records the mobile security audit and signed-archive preflight diagnostic, and assembles screenshots, metadata, docs, curated UI QA captures, release scripts, screenshot helper provenance, iOS config, archive facts, and validation logs into `build/mobile-app-store-package`. |
| Raw screenshot capture | Pass | Files, Remotes, Transfers, Settings/account captured from the live app. |
| App Store-sized fallback export | Pass | Five PNGs exported at 1320 x 2868 for iPhone 6.9-inch and optional 1242 x 2688 companions for iPhone 6.5-inch. |
| Designed local screenshot fallback | Pass | Five 1320 x 2868 PNG compositions and optional five 1242 x 2688 PNG companions generated from actual simulator captures with consistent device framing and App Review-safe copy. |
| Mobile release package verifier | Pass | `npm run verify:mobile-release` rebuilds the mobile bundle before scanning `dist` and passed with 768 local checks, 10 submission-owner warnings, and 0 failures. |
| App Store submission status | Pass with external blockers | `npm run app-store:submission-status` writes machine-readable and Markdown upload readiness reports; strict mode remains blocked by owner fields, final no-watermark screenshots, Apple signing/archive, and external TestFlight/provider QA. |
| Mobile security audit | Pass | `npm run security:mobile:audit` rebuilds the mobile bundle before scanning high-confidence secret formats and production mobile bundle strings for debug panels, extension UI, assistant placeholders, and desktop-style Files actions. |
| App Store owner-field validator | Pass with expected warnings | `npm run app-store:owner-fields:check` reports the missing production support/privacy URLs, App Review contact fields, and reviewer demo credentials without failing; use `npm run app-store:owner-fields:strict` after owner fields are supplied. The strict check rejects sample, placeholder, or local support/privacy URLs. |
| Butterkit-designed export | Paused pending UI approval | Butterkit MCP is reachable and draft exports were produced, but direct exports include a Butterkit watermark and final screenshot production is paused until the mobile UI is approved. |
| App Store/TestFlight upload/export | Blocked | Local Xcode Apple account token invalid; App Store Connect credentials/profiles needed. The archive script now preflights Team ID, build number, Xcode command-line tools, and signing identity before running the long archive; the handoff package includes `validation-logs/tauri-ios-archive-preflight.txt`. |
| Mobile extension UI bundle scan | Pass | No mobile dist hits for extension catalog phrases such as "Browse extensions", "Manage extensions", `usePluginsStore`, `pluginCommandRun`, or `pluginPanelRender`. The remaining `plugin:` strings are Tauri plugin protocol names. |
| Mobile native extension loader scan | Pass | The release verifier now requires native plugin service/runtime and command handler registration to remain desktop-only; the refreshed simulator archive binary has no hits for plugin install/scan/enable/uninstall command names, plugin command/panel/diagnostics names, `load_native_plugin`, `MistyPluginAbi`, `misty_plugin_register`, `PluginCommandService`, or `libloading`. |
| Mobile commerce copy scan | Pass | No mobile dist hits for pricing, subscription, payment, purchase, upgrade, external payment, or website purchase language after the mobile remote-limit message was reworded. |
| Mobile release-safe About copy | Pass | Mobile Settings no longer shows beta or shell wording; the production verifier scans source and `dist` for the old `v0.1.0-beta` and `Mobile shell` labels. |
| Mobile Account dead-button audit | Pass | Account overview static rows now render as non-buttons, while Notifications and Privacy navigate to Settings instead of presenting inert chevrons. |
| Provider OAuth with live credentials | Not run | Requires real provider credentials and reviewer/demo account setup. |
| Real device smoke | Not run | Requires signing profile/device registration. |

## Security and Privacy Review

Findings fixed:

- Desktop tray code no longer compiles into mobile, fixing the iOS build and avoiding desktop-only menu APIs.
- Native plugin command loading is no longer constructed in mobile runtime builds; mobile plugin commands return a clear unavailable error.
- Mobile Vite builds now avoid importing desktop page variants and desktop layout/plugin catalog UI.
- Mobile account/settings UI no longer presents purchase-adjacent language.
- Mobile provider remote-limit messaging avoids upgrade/purchase language in mobile builds while preserving the desktop upsell copy.
- iOS permission copy no longer references development services.
- iOS now includes a bundled privacy manifest with no tracking domains and App Functionality declarations for account, user-content, diagnostics, and required-reason API usage.
- iOS Info.plist includes `ITSAppUsesNonExemptEncryption=false` to avoid an unnecessary export-compliance questionnaire for the current standard-encryption-only app behavior.
- Mobile release builds no longer hardcode a LAN, localhost, or debug Misty account API in `.env.mobile`; production API configuration must come from the signing/export environment or the native runtime.
- Mobile web settings no longer default the advanced server override to `localhost:50051` when no setting exists; the desktop settings UI and native local runtime keep their desktop/local defaults where appropriate.
- Mobile notification settings now use the mobile-safe `device_notifications_enabled` setting key with fallback for existing legacy settings, and the verifier scans mobile Settings source plus production mobile `dist` for the old desktop-named key.
- Mobile native badge updates now subscribe to `device_notifications_enabled`, so disabling device notifications clears or suppresses the iOS app badge immediately.
- Client debug collection and the mobile Account debug panel are not bundled into production mobile builds; the mobile bundle verifier scans for debug UI labels and the client-debug storage key.
- Mobile-reachable Account/session stores now import shared Account API types and functions instead of desktop page API modules, and fallback runtime copy no longer says `Tauri desktop runtime` or `Tauri app` in production mobile bundles.
- Mobile AuthProvider no longer initializes from or writes the desktop/web persisted account profile cache in mobile builds; mobile keeps profile display state in memory while auth tokens remain in the Tauri keystore path.
- A repeatable mobile security audit scans source, native code, metadata, `.env.mobile`, and production `dist` for high-confidence secret formats and forbidden production bundle strings.
- Mobile file-action diagnostics and provider authorization diagnostics are gated to development builds; the production mobile verifier scans for the "Action debug" and "Provider auth debug" UI labels.
- Mobile `/diagnostics` deep links now redirect to Settings, are not remembered as mobile app state, and the production verifier scans for desktop-only fallback strings.
- Mobile page/tab bar containers and account action controls are width-constrained to prevent right-edge clipping on iPhone captures.
- iOS target family is iPhone-only, avoiding accidental iPad App Store support without iPad QA/screenshots.
- The rebuilt iOS app bundle no longer copies `libapp.a` as a resource; validators now ensure the Rust static library is linked only.
- Production render-error logging is dev-gated, and transfer-store recovery logging no longer prints raw SQLite errors that may contain local paths.
- The unfinished Mika assistant surface was removed from the mobile Files action sheet, and the verifier scans the mobile source/dist for assistant/dead-feature strings.
- Desktop-style Open With app selection and folder upload actions were removed from mobile Files action sheets; the shared Explorer store is mobile-gated and release/security scans keep those action strings out of the production mobile bundle.

Findings reviewed:

- Account auth token storage uses the Tauri keystore plugin and only stores a non-secret localStorage marker for keychain presence.
- Mobile Account clears password input state when switching account modes and after successful sign-in, registration, and sign-out.
- Provider sensitive fields use password inputs and hidden token fields by default.
- Provider Rust tests cover redaction of authorization/token error strings.
- Sign-out clears Misty's local account state even when network logout fails.
- Local proxy defaults to embedded runtime for mobile-safe operation and avoids external process assumptions for the simulator run.

Residual risks to verify before submission:

- Live provider OAuth/deep-link return must be tested with reviewer-safe credentials.
- Confirm privacy labels match actual network/account/provider behavior in App Store Connect.
- Generate and review Xcode's privacy report from the final signed archive before App Store submission.
- Confirm no debug environment variables are set in the release build uploaded to TestFlight.

## App Store Metadata Draft

App name: Misty

Subtitle: Files and cloud storage

Promotional text: Browse files, connect storage providers, and track transfers from Misty on iPhone.

Short description: Misty is a companion file client for browsing local and connected storage, managing providers, and tracking file movement from a secure mobile interface.

Full description:

Misty brings the core Misty file experience to iPhone. Browse files, connect supported storage providers, review transfer activity, and manage account and privacy settings from a focused mobile interface.

Misty for iOS is designed as a companion/client for Misty accounts and supported storage connections. It keeps file browsing, provider setup, transfer status, and account controls close at hand without desktop extension functionality.

Key features:

- Browse files and connected storage locations.
- Configure supported providers.
- Track upload, download, and sync activity.
- Manage account, privacy, notifications, and device settings.
- Use a mobile interface built for Misty's existing file workflows.

Category recommendation: Productivity

Keywords draft: files,cloud storage,transfer,sync,documents,remote storage,productivity

Support URL: missing. Add the production Misty support URL before App Store Connect submission.

Privacy Policy URL: missing. Add the production Misty privacy policy URL before App Store Connect submission.

Review notes:

Misty is a file browsing and storage companion/client. Reviewers should sign in with the supplied demo account to inspect account state, provider setup, file browsing, transfer history, and settings. The iOS app does not include in-app purchases, external purchase prompts, or extension/plugin functionality. Local network access is used for Misty's local secure runtime services on the device to browse and transfer files. Provider authorization may open the system browser and return through the `misty` URL scheme. The reviewer path ends in Account and Settings to verify sign-out, account state, privacy controls, and device settings.

## Publish Checklist

- Repair the local Xcode Apple account token and confirm the signing team owns `com.misty.mobile`.
- Confirm Xcode has a valid Apple Development identity for debugging exports or Apple Distribution identity for App Store/TestFlight exports, unless CI installs signing identities and uses `MISTY_IOS_SKIP_SIGNING_PREFLIGHT=1`.
- Create or confirm the App Store Connect app record for `com.misty.mobile`.
- Set app version `0.1.0` and build number `1` or the next approved build number.
- Confirm App Store Connect support is iPhone-only unless a separate iPad QA/screenshot pass is completed.
- Run `MISTY_IOS_DEVELOPMENT_TEAM=<team-id> MISTY_IOS_BUILD_NUMBER=<build> npm run tauri:ios:archive:preflight` before the full archive if signing state changed.
- Run `MISTY_IOS_DEVELOPMENT_TEAM=<team-id> MISTY_IOS_BUILD_NUMBER=<build> npm run tauri:ios:archive:app-store`.
- Confirm the archive script validates the built app `CFBundleVersion` against `MISTY_IOS_BUILD_NUMBER`; do not upload if it fails.
- Run `npm run tauri:ios:archive:validate` against the archive before upload.
- Run `npm run icons:ios:flatten` before archive rebuilds whenever icon source assets change.
- Confirm the final archive contains `PrivacyInfo.xcprivacy` and `ITSAppUsesNonExemptEncryption=false`, then generate Xcode's privacy report.
- Upload the archive through Xcode Organizer or Transporter after signing/export succeeds.
- After mobile UI approval, regenerate final no-watermark App Store screenshots from the approved simulator states.
- If Butterkit cannot see the screenshots, run `npm run screenshots:mobile:stage-butterkit` and use `BUTTERKIT_MCP_ASSETS_DIR=/path/to/folder` if Butterkit is configured with a custom Agent Import Folder.
- Enter metadata from this document or `marketing/app-store-metadata/en-US/app-store-connect.json`, with real support/privacy URLs.
- Run `npm run package:mobile-app-store` and use `build/mobile-app-store-package` as the local handoff folder for screenshots, metadata, validation logs, and archive facts. This command rebuilds the mobile web bundle before scanning `dist`.
- Add reviewer demo credentials.
- Complete App Privacy labels for account data, provider metadata, diagnostics, and any network behavior.
- Confirm no purchase, subscription, upgrade, pricing, or external-payment copy appears in iOS metadata or screenshots.
- Run `npm run verify:mobile-release` and resolve failures before upload. It rebuilds mobile before scanning `dist`. Expected remaining warnings are submission-safe Butterkit export absence until a watermark-free export is produced, missing Apple team env vars until signing/export is run, and owner-supplied App Store Connect fields until support/privacy URLs plus review contact/demo credentials are added.
- Run `npm run app-store:submission-status:strict` as the final machine-readable upload gate after the owner fields, approved no-watermark screenshots, signed archive, and external QA evidence are present.
- Run `npm run app-store:owner-fields:strict` after setting real support/privacy URLs, App Review contact fields, and reviewer demo credentials in App Store Connect or local environment variables. `marketing/app-store-metadata/en-US/app-store-owner-fields.env.example` lists the accepted environment variable names.
- Smoke test the TestFlight build on a real device: fresh install, sign-in, provider setup, file browsing, transfer action, settings, sign-out, app restart, offline/network failure, and deep-link return. Local simulator fresh-install smoke is covered by `npm run smoke:ios:simulator:fresh-install`.
- After that pass, create `build/mobile-external-qa-evidence.json` from the external-QA template, record the tested build/device/time, set every completed check and `passed` to `true`, and rerun `npm run app-store:submission-status:strict`.

## Fixed Bugs and Hardening References

- Mobile Transfers route no longer redirects to Files; `/transfers` renders the mobile Transfers page, participates in mobile navigation, and its first-run empty state routes users to Files or Remotes instead of ending at a dead state.
- Fresh installs now show a polished Misty welcome with real brand artwork, a local-browsing path, and in-app sign-in; completion is explicit rather than being triggered by an unmount, so React's development lifecycle cannot dismiss it on first launch.
- Account route changes clear inherited input focus, preventing a Files search field from carrying the software keyboard into a deep-linked sign-in screen.
- Simulator QA helpers now capture opaque PNGs after a conservative 30-second route settle; `npm run smoke:ios:simulator:ui` launches Misty before navigating every shipped mobile route so its UI evidence is not captured mid-launch. The mobile shell also isolates route stacking and keeps the non-Files header in an opaque elevated layer. Raw simulator manifests retain a visual-review flag because `simctl` can intermittently omit WebView layers in a frame.
- Mobile shell, Files, Remotes, Transfers, Account, and Settings interactions now use 44-point touch targets; Settings switches have explicit labels and valid switch semantics for assistive technology.
- Mobile builds avoid importing desktop page variants, desktop layout, and extension catalog UI into the mobile bundle.
- iOS native build no longer compiles desktop tray APIs or constructs the native plugin command service.
- Extension/plugin command handler registration is desktop-only on native mobile; the refreshed simulator archive binary has no plugin command-table entries.
- iOS release scripts validate build-number restoration after Tauri/Xcode generation.
- iOS archive creation now preflights the Apple Team ID, numeric build number, Xcode command-line tools, and local signing identity before running the long archive/export command.
- iOS device development now uses `scripts/run-ios-device.mjs` instead of a raw shell chain, preflighting Team ID, Xcode tools, and Apple Development signing identity before launching a device build.
- `npm run tauri:ios:device:preflight` and `npm run tauri:ios:archive:preflight` exercise those signing checks without building, and `npm run package:mobile-app-store` records both results as non-fatal handoff diagnostics.
- Provider remote-limit messaging no longer exposes upgrade language in the mobile bundle.
- `npm run verify:mobile-release` now rebuilds a fresh mobile `dist` by default before checking scripts, screenshot dimensions, curated UI QA captures, metadata/docs, iOS identifiers, archive plist values, sanitized logging, shared mobile Account API usage, mobile-safe runtime fallback copy, removed mobile assistant surfaces, mobile Account password-state clearing, mobile Transfers empty-state next steps, mobile-safe advanced server fallback, and mobile dist scans.
- `PrivacyInfo.xcprivacy` is bundled in the iOS target and simulator archive; export compliance is explicitly marked as not using non-exempt encryption.
- `scripts/build-ios-release.mjs` now validates App Store-critical archive metadata, privacy manifest contents, and app icon outputs after release build, and supports `--validate-only` for checking an existing archive.
- iOS app icon PNGs are flattened to opaque RGB with `scripts/flatten-ios-app-icons.swift`; the verifier checks all icon catalog slots and archive icon outputs.
- `scripts/package-mobile-app-store.mjs` assembles the local App Store handoff folder and records validation logs plus archive facts while clearly marking the simulator archive as not uploadable.
- `scripts/package-mobile-app-store.mjs` now runs `npm run build:mobile` before release verification and calls verifier/audit commands with `--skip-build`, preventing stale desktop `dist` output from being packaged or scanned as mobile evidence without duplicating the build log.
- `scripts/validate-app-store-owner-fields.mjs` validates the final owner-supplied App Store fields with redacted demo credentials, strict/non-strict modes, and rejection of sample, placeholder, or local support/privacy URLs.
- `scripts/audit-mobile-security.mjs` builds a fresh mobile `dist` by default and produces the repeatable security audit log included in the App Store handoff package.
- `scripts/verify-mobile-release-readiness.mjs` now scans the mobile bundle for extension UI, commerce copy, debug/private HTTP endpoints, production debug UI/storage strings, action/provider debug panels, assistant/dead-feature strings, browser-preview account bypass strings, screenshot-helper purchase-adjacent copy, structured metadata consistency, privacy-label draft consistency, and the mobile-safe advanced server fallback, with narrow allow-lists for React Router's internal URL parser fallback and internal screenshot-copy guidance.
- Mobile Files action debug and mobile Providers auth debug panels are development-only, preventing transfer paths, request payloads, provider auth URLs, and debug errors from appearing in App Store builds.
- Mobile Account no longer ships the client debug panel or statically imports client-debug storage in production mobile builds.
- Mobile Settings About now uses the runtime app version and the release-propagated iOS build number instead of beta/shell wording or a stale hardcoded build value, and the verifier prevents those regressions from reappearing in production mobile output.
- Mobile Settings notification controls now write `device_notifications_enabled`; the mobile layout reads the neutral device preference before setting the app badge, while shared settings selectors keep desktop compatibility.
- The mobile Activity sheet now uses separate left/right safe-area padding, avoiding edge clipping on devices with asymmetric safe areas.
- Mobile Account rows now separate static account facts from tappable actions, removing dead Profile, Email, Security, Devices, Notifications, Privacy, and Help buttons from the overview.
- Mobile Diagnostics is no longer exposed as a hidden desktop-only page; `/diagnostics` redirects to Settings on mobile and the release verifier checks route source, route memory, and production `dist` output for the removed fallback strings.
- Home, Changelog, SignIn, and Register now include mobile folders with redirect components; the release verifier checks these entrypoints and the top-level mobile SignIn/Register routes.
- `scripts/stage-butterkit-mobile-screenshots.mjs` stages the accepted simulator captures and a small import manifest into Butterkit's MCP assets folder for the final Butterkit-native export.
- Mobile account setup no longer overflows the viewport; the accepted account screenshot was recaptured from the fixed iPhone 17 simulator app.
- The generated Xcode project and rebuilt simulator archive now declare iPhone-only device family; release validators fail archives that accidentally include iPad support.
- The XcodeGen `Externals` group is excluded from build phases so generated static libraries are not copied into `Misty.app` resources.
