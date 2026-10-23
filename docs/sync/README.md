# Unified Sync — approved design

Approved for implementation, revision 2 (September 29, 2026), with the user’s subsequent corrections: black, white and gray only. Its server-account settings model is superseded: settings are device-local and never sync (AGENTS.md). Keep the incumbent navbar without its Account footer and show cohesive sections under small headers. `mockup.html` is a historical illustrative review artifact.

## October 1 popup simplification

The user approved direct implementation of a minimal popup: icon, title, one small status label, and device actions labeled **Open**. This supersedes the earlier popup-specific requirements for visible descriptive paragraphs and unavailable-action explanations. The popup has no device-section heading or per-device dividers. Detailed sync status remains available to assistive technology and in Settings; required recovery forms and actionable errors still appear when needed. Settings keeps its existing full explanations and controls. The popup has no routine Sync heading or status row, and starts directly with devices when healthy. Every device row has a right-aligned **Open** button, disabled when already open or unavailable. Device rows show one label: This device, Open here, connection state, or Opening…. **Manage sync** uses slightly larger text and no leading icon. Actionable recovery status and forms still appear when required.

## Purpose and visual direction

Misty desktop users should be able to tell what is syncing, why it stopped, and how to continue on this device. This is an Operate surface. Use black, white and gray only, including status, selection and focus indicators. Preserve the existing charcoal theme, compact typography, bordered settings sections and shared controls. The mockup mirrors those primitives; production must use `DesktopSettingsSection`, `DesktopSettingsRow` and `SettingsControls`, not introduce a parallel settings component system.

Preserve the current sidebar’s Search field, dimensions, row spacing, icon set, group dividers and selected treatment. Remove only the Account footer from its chrome. Existing right chevrons may remain as page-navigation cues; they never open dropdowns or nested lists. Preserve the `MonitorSmartphone` icon on the renamed **File sharing** area; it remains unique and keeps the incumbent icon language.

Each area opens one scrollable settings page. Sync contains Overview, Workspace devices, Website sign-ins, Switching devices, Settings sync and Sync account as visible sections under small, muted sentence-case headers. The sidebar stays stationary while settings scroll. No sub-page launcher list, tab strip, accordion or dropdown hides these sections. This revision supersedes the first mockup’s four chevron sub-pages. Search jumps directly to the relevant section.

## Screens and behavior

- **Overview:** one status title and an always-visible plain-language detail. Show only this workspace’s device roster, local device first. Each device has its name, inline Rename → edit and commit on Enter/blur, with Cancel, labeled Online/Offline/Connection unknown, a visible “Open its tabs here” action for remote devices, and a labeled Full sync switch with an explanatory sentence. Turning it off clearly describes Independent workspace. Full sync means “Share this device’s tabs and website sign-ins.” Independent workspace means “Keep this device’s tabs and website sign-ins here.” Account settings always sync independently of workspace mode. Disable unavailable tab actions with the reason beside the row; never infer online from missing presence. Device modes and renames need pending/error states and acknowledged server results.
- **Website sign-ins:** explain cookies and sign-in keys, and that some sites require another sign-in. Name the machine currently publishing using authoritative publisher data, not merely the viewed workspace or an online device. Reuse `DeviceWebsiteDataList` and its `WebsiteDataCoverage`, showing partial coverage first, with reasons, and visible fully synced sites grouped by device. The user’s no-dropdown direction supersedes the current coverage component’s collapsible presentation. Do not expose cookie values or sign-in key contents. No duplicate status calculation in this page.
- **Switching devices:** move the two existing page-restore toggles here, preserving their setting keys and their current privacy disclosures. Agent restore depends on page restore. Site exclusions remain in Browser → Privacy because the request moves only the two toggles.
- **Settings sync:** rename the current `SyncSection`, retain the pending preference count, and explain that changes are saved to the account on the server. Use the shared selector for preference failures and pending changes, and the shared recovery action. No local-only mode, device overrides or profile picker. The other settings-storage chat owns the account-record migration.
- **Sync account:** reuse `SyncVaultForm` for create, unlock and re-enroll: one Misty password and the remember-key control (see "One password" below). A vault made before account passwords keeps a sync password and sync secret field until it is moved over. Keep lock and forget-key actions with clear consequences. Forget key explains that the password will be needed again. Preserve existing encryption and metadata disclosure.

The popup is approximately 344–384 px wide and viewport constrained. Its order is: status title + detail, at most one contextual recovery action (or its in-place form), compact devices, “Restoring pages” only while active, and “Manage sync” to Overview. Device actions always remain visible. The popup has no workspace-mode controls, seats, takeover, or hover-only Switch to. Saved-key unlock and reconnect execute in place; rejected-device recovery opens the password form there. Missing saved key falls back to that form. Setup scrolls to the Sync account section.

The preview state radio group belongs to the review harness, not the product. It includes healthy, offline, locked, forbidden-device, setup and restoring states. Unrelated sidebar areas are shown as context and disabled in this preview.

## One status contract

`selectSyncStatus(input)` returns `{ tone, title, detail, action }`. `action` is null or a typed action descriptor. All renderers display detail, including success and neutral states. The selector accepts account-scoped workspace, local recovery, vault availability, website and profile-preference state; it rejects stale cross-account/session data. Page restore activity is supplemental rather than replacing sync health.

Priority: local persistence failure → authentication/access/key/integrity failures → other sync errors → setup/locked → offline/connecting → pending workspace/website/preferences → independent → up to date. A healthy workspace must not hide a profile failure. Independent workspace must not imply preferences are disabled. Do not assert “saved locally” unless local recovery confirms it. Show unknown device presence while disconnected. Detail identifies the affected scope.

All existing `syncIssueMessage.ts` codes receive explicit copy and exactly one next action:

| Code | Title | Detail | Single action |
| --- | --- | --- | --- |
| `sign_in_required` | Sign in to resume sync | Your Misty session has expired. Sign in again to reconnect sync. | Sign in |
| `sync_device_forbidden` | This device needs to reconnect | Its sync access was removed. Enter your sync password and secret to register it again. | Reconnect device |
| `vault_identity_failed` | Verify this device | Misty could not verify this device’s sync identity. Your existing local data is preserved. | Retry sync |
| `replay_conflict` | Sync needs to reconnect | Misty could not safely apply changes in order. Your existing local data is preserved. | Retry sync |
| `checkpoint_or_key_recovery_required` | Sync needs recovery | Misty needs to restore its sync connection or unlock the vault again. Your existing local data is preserved. | Retry sync |
| `local_storage_unavailable` | Local saving needs attention | Misty cannot write sync data. Check available disk space, keep Misty open, then retry. | Retry sync |
| `sync_protocol_failed` | Sync could not complete | Misty could not finish exchanging changes with the server. | Retry sync |

Additional branches: saved-key unlock → Unlock sync; no remote vault → Set up sync (only after confirmed absence); profile-only errors → Retry sync with preference-specific detail; unknown errors → safe human fallback and Retry sync (do not display raw protocol codes). Recovery actions never bypass integrity checks or silently reset data. Persistent integrity/key errors remain visible and expose the existing supported recovery form where appropriate.

## One recovery path

`retrySync()` is the sole recovery orchestrator called by settings and popup. Its action variant comes from the selector. It routes account sign-in, native local recovery, saved-key unlock, reconnect, and profile refresh as needed. Forbidden-device recovery invalidates the rejected saved identity and requests the sync password and secret for re-enrollment, preserving existing local data. Vault absence/unknown availability must not be confused. If explicit credentials are required, the orchestrator returns that state to the calling surface rather than redirecting everything to Settings.

Use one pending guard, generation/account checks before mutations, one busy label, and a visible failure detail. Repeat activation while pending cannot start duplicate native operations. A success means acknowledged state, not merely dispatching an event. Keep unrelated Rename, Open tabs and vault-management actions separate from retry recovery.

## Registry, backend dependency and validation

`src/features/settings/settingsRegistry.tsx` is the only navigation registry. One canonical Sync area (`sync`) contains named section targets instead of separate pages. Existing and proposed `sync-*` destinations can resolve to section targets for compatibility and search. File sharing may retain the existing `devices` id. Redirect legacy `browser-handoff` to `sync`; redirect legacy `profiles` to the Settings sync section. Update search and navigation consumers through the registry. The global sidebar keeps its current look, stays flat with unique icons and no ampersands, and omits the Account footer.


**Part A3 is a landing dependency.** Current `DeviceControlContent` calls `claimNativeTree`, and `treeControl.ts` exposes seat semantics. Before production UI lands, verify the backend supplies non-exclusive tab opening, publisher identity, workspace device membership and stable per-device mode controls. Do not merely relabel a seat claim as opening tabs. Remove `SeatCheckScreen`/seat gating and `BrowserSyncSleepOverlay` together with the backend seat retirement; preserve unrelated page restoration and local recovery protections. The user confirmed Part A3 is handled in another chat. Its non-exclusive API is not yet present in this checkout; keep the existing seat protections until that migration lands.

Required tests after approval: update `BrowserSyncBadge.test.tsx`, `BrowserSyncSettings.test.tsx`, `SettingsWorkspace.test.tsx` (remove Browser Sync versus Sync split), `BrowserSyncSleepOverlay.test.tsx`, `SeatCheck.test.tsx`, and `treeControl.test.ts`. Add selector coverage for every issue code, precedence, saved/unsaved recovery, mixed workspace/profile health, unknown presence, unsupported website sync, independent mode, setup/locked, account transitions and unknown-error fallback. Add shared recovery tests for saved-key unlock, missing-key form, forbidden re-enrollment, pending deduplication and stale-account cancellation. Verify every visible control, no tab strips, unique sidebar icons and no ampersands, always-visible detail and device actions, and Manage sync routing to Overview.

Implementation is authorized. The user confirmed that another chat owns Part A3. The UI and account-settings changes can be reviewed here, but shipping non-exclusive tab opening and removing seat overlays must wait for that backend contract. Existing exclusive `claimNativeTree` wiring is explicitly temporary, not evidence that Part A3 is complete.

## Review verification

Revision 1 browser checks covered chevron navigation and in-popup re-enrollment; revision 2 supersedes them. Revision 2 replaces hand-drawn sidebar approximations with the same Lucide icons used by the current registry, restores Search and the incumbent sidebar geometry, removes the sub-page launcher list, and exposes all Sync sections. Preview controls change sample state only. No production tests are claimed for this standalone mockup. Existing unrelated working-tree changes remain untouched.

Revision 2 checks: browser confirmed Search finds Switching devices and the section is exposed on the same page; turning off page restore disables agent restore. Desktop and narrow-pane layouts were inspected. The layout detector returned no findings in degraded regex mode (HTML parser dependencies unavailable), so this is not a complete accessibility audit.

## Implementation handoff

Browser review used the real React components with sample native/account data at desktop and narrow desktop widths, including the in-popup re-enrollment form. The account form uses one section, and rows respond to their container width.

The settings/sidebar, coverage, recovery and status tests pass after updates, including generation cancellation, shared retry deduplication, settings-only versus workspace recovery, explicit lock during startup, server-confirmed device changes, and server-confirmed vault absence. TypeScript and targeted ESLint checks pass. The legacy sleep/seat/tree regressions remain in place for Part A3; they have not been removed prematurely. Seat-check recovery already uses the shared status/controller, and the old event-based retry path and standalone device-name section are removed.

Part A3 handoff: replace the temporary `claimNativeTree` call and acknowledgment check in `SyncDeviceList.tsx` with the non-exclusive open-tabs API, then remove the seat overlays/gating and update `BrowserSyncSleepOverlay.test.tsx`, `SeatCheck.test.tsx` and `treeControl.test.ts` together with that backend change. This work does not claim completion of the backend migration.

## Interface rules

- Approved Sync direction: this brief, revision 2, including the approved monochrome palette. Its server-account settings model is superseded: settings are device-local. Historical mockup screenshots do not override these instructions.

## One password (2026-10-22)

Sync is sealed under the person's Misty password; there is no separate sync password or secret to keep. Design and plan: [docs/plans/extensions-sync-plan.md](../plans/extensions-sync-plan.md).

- **Two values from one password, on the device.** Argon2id stretches the password with a salt taken from the server's address and the account email (so the same email and password give each Misty server a different credential), and HKDF splits the result: a login credential and a vault wrapping key (`AccountKeys` in `src-tauri/crates/browser-sync/src/crypto.rs`). The desktop app sends the server the credential where it used to send the password, so the server never sees the password the vault key comes from. The wrapping key never leaves the device.
- **Accounts that hold their password the old way.** The server has seen those passwords in plain form, so they must not seed keys. Sign-in tries the credential first. For an account this device has not seen sign in with a credential, it then sends the password as typed; one that only works that way is not remembered as a credential account and is asked to choose a new password (`SyncPasswordDialog`) before it gets an account wrapper. For an account this device knows uses credentials, the password is never sent in plain form: a wrong password just fails, and after a reset by email the sign-in page offers "Sign in with the reset password" as an explicit choice. A password reset by email means the server saw the new password, so the vault is reset. The device also remembers the exact email the keys were derived from, so a changed email on the server does not change them.
- **Google accounts** have no Misty password. The sync password is chosen on the device, asked twice, and never sent anywhere.
- **Moving a vault over.** Re-sealing the open vault (`browser_sync_use_account_password`) creates an account wrapper, signs a key transition with the vault root for the next generation, and sends both to `PUT /sync/vault/key`. Every device checks the transition against the root public key it pinned at enrollment (`CachedVault::check_remote`), so the server cannot swap or replay a wrapper. A device that was offline adopts the new wrapper the next time its password is typed. A password change re-seals the open vault first, then changes the server's password, then marks the account safe, and ends every other session of the account. The vault key itself is not rotated: someone holding an old copy of the wrapper and the old password can still open it, so a leaked password needs a vault reset, not just a change.
- **Forgotten password.** The vault cannot be opened. Reset sync removes the synced data from the server and every device starts it again from its local copy.
- **Strength.** The server cannot judge a password it never sees, so the rules (12 characters or more, no common passwords, no runs, not the email) run on the device (`password.rs`).
- **Not covered here.** Web sign-in has no native key derivation and keeps sending the password as typed; an account can sign in on the web only until it moves to a derived credential. Status: built and unit tested. The migration, the key-rotation store code and the password change were run against a throwaway PostgreSQL 16 on 2026-10-22 (`TestRotateVaultKeyAgainstPostgres`, `TestChangePasswordAgainstPostgres`, gated by `MISTY_KEY_TRANSITION_TEST_DSN`) using small tables that hold only the columns they use, not the full migration chain (it needs pgvector). The HTTP handlers, row-level security and the app are not yet run.

### Independent review, 2026-10-23

A reviewer who saw only the code found the cryptographic core sound (key independence, wrapper binding, signature scope and the Rust and Go agreement) and a number of exposures in the sign-in and password-change flows. All but the items below were fixed the same day:

- No automatic plaintext sign-in or password-change fallback for an account the device knows uses credentials; the person asks for it after a reset by email.
- The current password cannot be reused as the new one; the vault is re-sealed before the server password changes; other sessions end with a password change; the email the keys derive from is pinned on the device; the server's address is part of the derivation; passwords and emails are put in NFKC form; generation counters cannot overflow; length counts characters.
- The server records whether an account's password hash is of a derived credential (`users.credential_password`, set on register and password change with `credential: true`, cleared by a reset by email) and returns it at sign-in and in `/me`. A device whose local record disagrees with a `false` from the server drops its record, so a reset made elsewhere is noticed.
- New vaults must use the account wrapper; the server refuses the sync-secret wrapper on creation.
- Deleting a vault (and so every device's synced data) needs the account password, checked on the server with a limit of five wrong attempts in fifteen minutes; replacing a wrapper is limited to ten requests in ten minutes. A forgotten password is recovered by resetting it by email, signing in with the reset password, and then resetting sync.

Still open:

- **The server's flag can be lied about.** A malicious server can still get the password as typed from a device that has never seen the account sign in with a credential, and can claim an account is safe when it is not. Only an in-app reset that sends a derived credential, and a server that cannot be trusted less than the device, would remove that.
- **A near variant of an old password** (not the identical one) is not caught for an account the server saw in plain form.
- **A server holding an old signed transition** can have a device pinned at an earlier generation adopt a stale wrapper (a lockout, not a leak).
- **The sign-in lockout** is per process and in memory, and the credential and plain attempts of an older account count separately.
- **The unlock form shown** follows the server's report of which wrapper protects the vault; it can only phrase a prompt, because unlocking runs locally.
- **The vault key is not rotated** by a password change, so a leaked password needs a vault reset.
