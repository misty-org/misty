# Plan: extensions, ad blocking, passwords and sync

Written 2026-10-22. Status of each track is at the end.

## Decisions

- **Chrome MV3 extensions only,** on every platform. Firefox Add-ons is hidden everywhere; its code stays in place.
- **Ad blocking and passwords are extensions.** Misty builds nothing native for them.
- **Sync needs one password.** Onboarding is: sign in, sync unlocks, then optional extension choices.

## Option A: what changed

Login sends the raw account password to the server, which hashes it with bcrypt (`server/internal/accounts/users.go`). If the sync key were derived from that same password, the server would see it at every login and could unwrap the vault, so it would not be end-to-end. The fix is to derive two independent values from the password on the device: a login credential for the server, and a wrapping key for the vault root that never leaves the device.

Google sign-in accounts have no Misty password. They must set one during onboarding.

## Track 1: Extensions (critical path)

1. Verify on Windows. Check that Add to Misty appears on Chrome Web Store pages and the install completes. Then test uBlock Origin Lite, Bitwarden, 1Password and Dark Reader, and record pass or fail (`docs/plans/extensions-windows-test.md`).
2. Fix the worst failures. The live intake test (`windows_limited_apis_for_chrome_store_extensions`, run with `--ignored`) shows which of the APIs WebView2 does not offer (`LIMITED` in `src-tauri/src/infra/extensions/native_windows/mod.rs`) each package asks for. On 2026-10-22: uBlock Origin Lite and Dark Reader ask for none; Bitwarden asks for `contextMenus`, `sidePanel` and `notifications` (core fill and popup do not depend on them); 1Password asks for `nativeMessaging`, `contextMenus`, `downloads` and `notifications`, so its desktop-app features are the likeliest to fail.
3. Repeat on macOS, where Kiri's compatibility layer does the work.
4. Hide Firefox Add-ons everywhere (store button, settings rows, install flow). Keep the code.
5. Linux: WebKitGTK has no extension runtime today. Launch Windows and macOS first; Linux onboarding shows no extension choices.
6. Agent defaults: new installs are off limits to agents until the person allows it (`install.rs` and `install()` in `src/features/extensions/store.ts`). Extensions already installed keep their setting.

Effort: large on Windows, medium on macOS.

## Track 2: Remove the built-in ad blocker (small)

Delete `src-tauri/src/infra/browser/scripts/adblock.js`, `src/features/webviews/adBlocking.ts`, and the references in `src/features/settings/devicePreferences/definitions.json`, `src/features/settings/store/useSettingsStore.ts`, `src-tauri/src/infra/site_settings/style.rs` and `src-tauri/src/infra/browser/scripts/mod.rs`. Check what else the gap-analysis session wired to it first.

## Track 3: Password manager

- Keep the built-in manager as the fallback, including the generator and CSV import and export.
- Do not extend it: no native TOTP, breach check or autofill.
- Password-manager extensions are the main path, so success depends on Track 1 step 2.
- Fix the fill menu's hardcoded dark theme (`scripts/passwords.js`) only if the built-in manager stays visible.

## Track 4: Sync with one password (Option A)

1. Derive two keys from the account password with argon2id (already used in `browser-sync/src/crypto.rs`): a login credential for the server, and a wrapping key for the vault root.
2. Remove the sync secret: drop that input from `wrapping_key()` and the secret field in `src/features/browser-sync/SyncVaultForm.tsx`.
3. Migrate existing accounts: on a device where the vault is already unlocked, re-wrap the root under the new key at next login. Accounts with no unlocked device need a reset.
4. Password changes and resets need a signed key-transition feature. `check_remote` in `store/vault.rs` rejects any wrapper change the server sends, so re-wrapping needs an authenticated path that does not exist yet.
5. Google sign-in users set a Misty password during onboarding.
6. Password strength now carries the security: keep the 12-byte minimum, reject common passwords, consider raising the argon2 memory cost.
7. Update `docs/sync/README.md`, which describes the password-and-secret flow throughout.
8. Get a security review. This is cryptography and login code.

Effort: large. Independent of Track 1, so it can run in its own session.

## Track 5: Onboarding (last)

Sign in with the account password, sync unlocks, then optional choices for an ad blocker and a password manager. Show only extensions that passed Track 1, and use the browser import flow to suggest the ones the person already had. Both choices are skippable and available later.

## Order

1. Tracks 1 and 2 first (Track 2 is quick).
2. Track 4 in parallel, as a separate session.
3. Track 3 only as fixes arise.
4. Track 5 when extensions and sync are ready.

## Risks

- Extension quality on Windows is unknown until Track 1 step 1 runs. The plan leans on it.
- 1Password asks for `nativeMessaging`, which WebView2 does not offer extensions, so its desktop-app features may not work. Bitwarden does not ask for it.
- Migrating sync without losing anyone's vault is the riskiest part of Track 4.
- The other session's built work (password generator, CSV) has not been run in the app.

## Status (2026-10-22)

- **Track 1 step 4 (hide Firefox):** done. `offeredStores` in `src/features/extensions/store.ts` lists Chrome only for the toolbar, menu and Settings; the store page script and the host check no longer read Firefox Add-ons pages. Firefox code and already-installed Firefox extensions are untouched.
- **Track 1 step 6 (agent defaults):** done; new installs default to agent access off.
- **Track 1 steps 1 to 3 (verify and fix on each platform):** not done. Needs a person to run Misty; see `docs/plans/extensions-windows-test.md`. The live package intake passes for the Chrome Web Store packages (download, hash and CRX signature), but no extension has been run.
- **Track 2 (remove the built-in ad blocker):** done. It was uncommitted work, so the files are simply gone.
- **Track 3 (passwords):** built-in manager left as is.
- **Track 4 (sync):** in progress in a separate agent; see its report.
- **Track 5 (onboarding):** done in code. A skippable "Add an ad blocker and a password manager" step sits between import and tab side, shown only where extensions run (`ExtensionsSetupStep.tsx`, `FirstRunSetup.tsx`). Not seen in the running app.
