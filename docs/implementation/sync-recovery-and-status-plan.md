# Sync recovery and visible status

## Problem and evidence

The reported “Your workspace could not be restored” screen comes from local encrypted recovery, before cloud sync starts. `AppFrameLayout` previously replaced the signed-in shell when local recovery failed. `BrowserSyncStartup` already reconnects in the background. The screenshot alone does not identify the underlying native failure: workspace recovery currently maps several storage and Keychain failures to the same message.

The user should always be able to browse while recoverable storage or network failures are being retried. Recovery must preserve account isolation, original encrypted data, unsaved work, and the active-device ownership rules.

## Implemented in this change

- Local read/write failures leave the browser usable. A stalled initial restore falls back to a temporary workspace after three seconds while the original operation continues.
- Retry after 2 seconds, then back off to a 30-second maximum; retry immediately on window focus or network return. Only one background attempt runs at a time. Account generation changes invalidate late results.
- If the saved workspace is readable, show it even when saving fails. If it cannot be read, open an isolated temporary workspace. Keep original records and legacy copies until native writes are acknowledged.
- When storage recovers, retain temporary windows and current selection beside restored windows. Persist the recovery baseline so recovered edits enter the sync journal before a cloud projection can replace them. Only the active device may publish those edits.
- Show a permanent Control pill after the back/forward controls in the desktop titlebar. Green indicates healthy sync, red indicates local saving, sync, offline, or website-profile failures, and neutral indicates an unconfirmed connection. Clicking opens device controls, status, Retry now, and Settings. Keep the exit-loss warning inside this popover; there is no bottom notice.
- Prevent account switching from silently discarding modified temporary state. Existing account-change flush protection remains in effect.

This is automatic retry and safe degraded operation, not a claim that missing encryption keys or corrupt records can always be repaired. Those cases keep their original data and remain actionable. Device sleep remains an ownership feature; its nonmodal screen leaves the titlebar Control popover available.

## Sync control

**Audience and job:** an everyday browser user should know whether their work is saved, whether another device has it, and what action is needed without visiting Settings. Operate mode; retain the charcoal shell, existing icon assets, compact controls, and restrained semantic color.

**Implemented placement:** one permanent “Control” pill immediately after the back/forward arrows in the desktop titlebar, visible with the navigator collapsed. It uses a sliders icon with green healthy or neutral unconfirmed styling, and a red warning icon for failures. Labels and tooltips communicate status without relying on color. The compact, scrollable popover remains above the nonmodal device-sleep screen and retains Local saving, Website data, Retry now, and Settings.

**Device controls:** list account-enrolled browser sync devices, with WebSocket presence shown as Connected, Offline, or Unknown and the active device labeled. Switch / Use here remains pending until signed activation is confirmed. Connected devices supporting the control protocol expose Full sync: off keeps the device connected with an independent workspace; on rejoins the shared workspace. The toggle retains its confirmed value while an explicit “Turning Full sync on/off…” status is pending. Unsupported devices explain that the server and device need updating.

**Traffic:** Upload and Download show this local device’s sync WebSocket payload bytes per second. They exclude website traffic and HTTP/TLS connection overhead. An unavailable or initial sample displays a dash.

The following table records the broader status design, not the fixed Control trigger’s current icon or label; explicit unlock/setup actions, last-success timestamps, and mobile presentation remain future work.

| State | Icon treatment and label | Detail and action |
| --- | --- | --- |
| All confirmed | Still sync icon; “Up to date” | Last confirmed sync; saved locally; no action required |
| Actual work pending | Rotate during activity; “Syncing” | Changes waiting or receiving; do not invent a percentage |
| Offline, saved locally | Offline badge; “Saved on this device” | Changes will sync when connected; Retry now |
| Restoring local storage | Recovery badge; “Recovering” | Retrying automatically; explain whether current changes are durable |
| Local save failure | Warning badge; “Not saved yet” | Show the exit-loss warning in the popover; Retry now |
| Locked or missing authorization | Lock badge; “Sync needs attention” | Unlock sync or Sign in, based on a structured reason |
| Another device active | Device badge; “Active on another device” | Identify the device when known; existing activation action |
| Not configured | Still icon; “Sync not set up” | Set up sync; never imply the user is already syncing |

Respect reduced motion: use a still icon and state text. Keyboard users can open, dismiss with Escape, and return focus to the trigger. Announce meaningful state transitions politely; do not announce every retry or pending-count update. Mobile targets are at least 44×44 px. Test long device/account names, narrow widths, and 200% text size.

The broader recovery detail design below remains planned beyond the implemented device controls, status, Local saving, Website data, Retry now, and Settings:

1. **Local saving:** Saved on this device / Not saved yet / Temporary workspace.
2. **Across devices:** Up to date / N changes waiting / Offline / Needs attention.
3. **Website sign-ins and storage:** a separate status from native browser profile readiness; workspace sync does not prove cookies or website storage are ready.
4. One relevant primary recovery action, followed by Sync settings and Copy diagnostics. Diagnostics must exclude URLs, page titles, cookies, tokens, and encryption material.

“Up to date” requires acknowledged local saving, a ready worker, no pending edits, applied sequence at the known server head, and no recovery or profile issue. Current native status does not expose a last-success timestamp; add an acknowledged timestamp before showing one. Do not substitute a timer tick or successful connection for a completed sync.

## Remaining implementation sequence

1. Add structured recovery reason codes at the native boundary: credential-store unavailable, missing key, database locked, disk write failure, invalid record, authentication required. Preserve safe user copy and collect only redacted stage/retry diagnostics. Use these to avoid repeatedly prompting for credentials or retrying a permanently unrecoverable condition as though it were transient.
2. Build one derived status model from local recovery, worker state, edit-journal durability, and browser-profile health. Keep error state until the affected operation is acknowledged; incidental native events must not clear it.
3. Completed the desktop Control pill, device controls, and status popover using existing shell popover/focus primitives. Extend the detail view with reason-specific actions and native mobile presentation.
4. Add explicit recovery for permanent failures: restore a verified backup or remote copy without discarding originals; let users inspect/export preserved work before replacing anything. Never regenerate an encryption key over an existing unreadable database.
5. Verify on a signed native build with Keychain temporarily unavailable, a locked database, offline startup, disk-write failure, app suspension/resume, and two-device activation. Verify readable originals, temporary edits, focus, native browser bounds, and post-relaunch journal recovery. Include a crash between journal persistence and baseline cleanup to prove replay is idempotent.

## Acceptance checks

- A failed or stalled local restore does not leave the app on a full-screen error or indefinite spinner.
- Work opened during recovery remains visible and reaches the durable edit journal before cloud projection.
- Account B never displays or saves Account A's workspace; late operations cannot change the current account.
- Unavailable local saving is never presented as Saved or Up to date.
- Retry remains automatic and bounded; normal browsing and keyboard navigation continue.
- The sync control remains discoverable with the navigator closed and across browser panes.

## Control review and rollout scope

The finish review accepted the bounded fixture UI after the Full sync pending-message fix. Evidence: [desktop](../../.impeccable/review/device-control/desktop.png), [sleep with Control](../../.impeccable/review/device-control/sleep-control.png), [independent workspace](../../.impeccable/review/device-control/independent.png), and [pending change](../../.impeccable/review/device-control/pending.png). These are simulated browser fixtures, not packaged-native or real two-device evidence; no native parity is claimed.

Native/server implementation and tests exist. Device controls require the additive server migration and a rebuilt native app; the backend has not been deployed. Signed-native and two-device acceptance checks remain outstanding.
