# Automatic browser workspace handoff

The desktop path now starts from account sign-in. Separate cookie probes and
manual capture/restore buttons are no longer part of the user flow. Device and
provider acceptance testing is left to the user; compile success is not a claim
that Google, GitHub, Microsoft or every website will accept a transferred session.

## Development delivery (2026-09-23)

The packaged macOS ARM64 and Windows x64 development builds use
`https://dev-api.mistysys.com/v1` for Misty Hosted. Downloads are under
`artifacts/browser-handoff/`, with SHA-256 hashes in `SHA256SUMS.txt`.
Both platforms and the API compile; cross-device runtime acceptance remains
with the user.

The full development stack was deployed with `misty server up` after the user
approved all pending migrations, including the GPT-6 Astra Agents migration.
The database is at `20270213000000`; the API, agent runtime and existing backing
services are healthy. The collaboration Worker deployment completed successfully
(version `3887a7df-7170-410d-98f8-5c26b335a9cc`). The Cloudflare tunnel stayed online.
The hosted `/v1/health` returns `status: ok`; `/v1/sync/workspace` and
`/v1/sync/devices` return the expected `401 not_authenticated` without a session.
These deployment checks establish availability, not successful cross-device
session restoration. The user will perform that acceptance test.

The running API is `misty-server:local`, image
`sha256:cadcfb85836f0b632fe0e7236af79de10b25d1ee1d12a3a3672a033cd4454651`.

A private database backup and previous-image identifier are stored outside
both repositories at
`~/.local/share/misty/backups/browser-handoff-20260923-115758/`.
The previous Docker image remains tagged
`misty-server:before-browser-handoff-20260923-115758`.

## User flow

1. Run the updated Misty desktop application on the Mac. Connect to the updated
   Misty server and sign in. Create the encrypted workspace if this account has
   none, saving the sync password and generated secret. Select **Remember vault
   key** to reconnect automatically on this device.
2. Open websites, sign in, arrange tabs/splits/windows, and let Device sync finish.
3. Run the updated Windows application against the **same server and account**.
   Unlock with the same sync password and secret. Remember the key if wanted.
4. The workspace receives the source layout and restores supported website data
   automatically. Change a URL, split, title, selected tab or virtual window on
   either device; the other device should follow after the bounded capture delay.
5. Disconnect/reconnect Windows and verify it catches up. Restart either app to
   check remembered-key reconnection and independent native layout recovery.

Both applications and the server must include the browser-sync implementation.
An older hosted server will not gain the new endpoints from a desktop update.
No server deployment is performed by the desktop build.

## Implemented paths

- Native encrypted workspace recovery before the desktop mounts, including owned
  legacy browser-storage migration. Quiet-period writes are batched at 400 ms,
  bounded at 2 s, and unchanged values skip writes.
- Account startup checks for a vault and uses an explicitly remembered OS key.
  New devices request the password and secret; the server cannot unlock the data.
- Workspace changes and the latest device selection flow over the existing
  authenticated encrypted WebSocket protocol. Incoming projections do not echo
  back as user edits or restart agent actions.
- Native cookie observations, website localStorage, per-tab sessionStorage, and
  portable IndexedDB exports. Website secrets never cross the Misty renderer IPC.
- Automatic initial browser-profile preparation and incoming restoration. Existing
  profiles are refreshed in place when possible; failed imports are quarantined
  and recover through a separate profile. Old native profiles are retained.
- Session storage is initialized before a restored tab navigates, with a native
  bootstrap script removed after its first real document load.
- Origin storage helpers use inert same-origin documents: WebKit loads native
  HTML with a base URL; WebView2 fulfills helper requests with empty local HTML.
- Credential publication includes changed storage areas only. Unchanged native
  observations do not create new encrypted operations or PostgreSQL writes.

## Current bounds and unfinished product work

This is workspace replication, not a stream of the website's JavaScript heap or
pixels. Unsaved in-memory forms, service-worker/cache-storage state, passkeys and
non-exportable CryptoKeys are not portable. IndexedDB cyclic/custom values and
unsupported cookie attributes produce an issue instead of pretending to transfer.
IndexedDB key-generator counters beyond the largest surviving key are not exported.
The current credential operation limit is 1 MiB; large website databases can exceed
it. Imports are not yet optimized into separately referenced large components.

Website storage capture currently covers top-level mounted tabs and the known
workspace origins at initial capture. Previously captured closed origins remain in
the encrypted document. Independent cross-origin iframe storage is not enumerated.
Incoming credential changes reopen browser views and stop active agents before
replacing their contexts. They do not migrate an in-flight agent action.

The backend/native transport still uses the earlier encrypted event log. The
accepted latest-snapshot/CAS/component-reference redesign, complete retired-app
cleanup, profile-retention cleanup, and rotation/revocation UX remain separate
unfinished work. Do not advertise universal signed-in website portability or a
completed snapshot migration based on this build.
