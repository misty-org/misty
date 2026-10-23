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
5. Google sign-in users have no Misty password: they choose a sync password on the device, asked twice, and it is never sent.
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
- **Windows install bug found and fixed (2026-10-23).** Every real store extension failed to load on Windows: WebView2 answered `Access is denied` (0x80070005) to `AddBrowserExtension`, because Misty's staged copy still held its own `__misty_sync__` folder and Chromium refuses an extension with a folder named like that. Found by loading the real packages into a real WebView2 profile (`webview2_loads_real_store_extensions`, `--ignored`); staging now leaves out `__misty_` folders, and folders staged before the fix are not reused. uBlock Origin Lite, Bitwarden, 1Password and Dark Reader then load under Misty's IDs and their popups open. A second Windows bug found while reading the code: removing an extension dropped its page host by the wrong key, so a removed extension's pages stayed allowed (`installation_host`; tested). The app was not run; restart it, and reopen a tab, so the extensions load.
- **Track 1 steps 1 to 3 (verify and fix on each platform):** partly done on Windows (see above); not done in the app. Needs a person to run Misty; see `docs/plans/extensions-windows-test.md`. The live package intake passes for the Chrome Web Store packages (download, hash and CRX signature), but no extension has been run.
- **Track 2 (remove the built-in ad blocker):** done. It was uncommitted work, so the files are simply gone.
- **Track 3 (passwords):** built-in manager left as is.
- **Track 4 (sync), built and unit tested; database code run on a throwaway Postgres, app not run.** The one-password design is in [docs/sync/README.md](../sync/README.md) under "One password".
  - Crate (`browser-sync`): `AccountKeys`, the account wrapper, root-signed key transitions, `check_remote` accepting only a root-signed newer generation, `adopt_rotated_vault`, `rotate_key`, and the password rules in `password.rs`. 6 tests in `tests/account_wrapper.rs`; the crate suite passes.
  - Server: `PUT /sync/vault/key` and the account KDF (`key_transition.go`, migration `20271105000000_sync_vault_key_transition.sql`), and `PUT /me/password` (`httpapi/change_password.go`). A Go test checks that the server verifies a transition signed by the Rust crate. `go build`, `go vet` and the non-database tests pass. The migration, `RotateBrowserSyncVaultKey` and `ChangePassword` were run against a throwaway PostgreSQL 16 with small stand-in tables (`TestRotateVaultKeyAgainstPostgres`, `TestChangePasswordAgainstPostgres`; set `MISTY_KEY_TRANSITION_TEST_DSN` to an empty database whose name contains `test` or `check`): a signature made by the Rust crate is accepted; a replay, a skipped generation, a forged signature, a legacy wrapper and another account are refused; the constraint holds. The full migration chain could not be applied (it needs pgvector), and the HTTP handlers and row-level security have not run.
  - Native: `account_login_credential`, `account_check_password` and `browser_sync_use_account_password` (`account_credentials.rs`); setup creates account-wrapped vaults; unlock opens either wrapper and adopts a newer one from the server; `browser_sync_availability` reports which wrapper a vault has. The old `browser_sync_generate_secret` is gone.
  - App: sign-in tries the derived credential and then the password as typed, register sends the credential after checking strength, `SyncVaultForm` asks for one password (the secret field stays only for old vaults), `SyncPasswordDialog` moves an old vault over or changes the password, and a settings row opens it. Tests cover sign-in, the password change, the form and the dialog.
  - Known trade-offs: an account that has moved to a derived credential cannot sign in on the web (nothing there can derive it); a forgotten password means Reset sync; an email password reset leaves the server holding a password it saw, so sync must be reset.
  - Reviewed 2026-10-23 by an agent that saw only the code (not a substitute for a human review). It confirmed the core and found client-flow exposures; the fixes and what is still open are listed in docs/sync/README.md. Not done: a human security review, a run of the HTTP handlers against the real schema, and a run of the UI. Two behaviors to watch when it is first run: sign-in counts the failed credential attempt toward the lockout before the fallback, and a stale local vault adopts the server's newer wrapper only when the password is typed.
- **Track 5 (onboarding):** done in code. A skippable "Add an ad blocker and a password manager" step sits between import and tab side, shown only where extensions run (`ExtensionsSetupStep.tsx`, `FirstRunSetup.tsx`). Not seen in the running app.

### Order that was followed for sync

The account wrapper is only end-to-end if the server never sees the password it is derived from, so the login credential replaces the raw password first and the wrapper is turned on after. Decisions taken so the work could proceed (change them in the brief if wrong): a forgotten password resets sync from the devices' local copies; existing accounts are prompted, not forced, and keep working with their sync secret until they choose a new password; web sign-in stays on the password as typed and does not work for an account that has moved to a derived credential.
