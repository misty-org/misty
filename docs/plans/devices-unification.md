# Devices unification — implementation plan

Implements [docs/design/devices/BRIEF.md](../design/devices/BRIEF.md). Written October 5, 2026 against `main` at `7c426e81f`.

## Status (October 5, 2026)

Phases 0–6 are implemented, uncommitted. Where the build differs from this plan:

- **One registry, evolved in place.** `trusted_devices` gained `admission_state`, `identity_version` and the grant columns (migration `20271005100000_unified_devices.sql`) instead of a new `devices` table, so existing foreign keys keep working. Legacy webview-key rows can do nothing; a legacy row whose network key matches the new device key is upgraded in place.
- **Sync signing keys are bound, not replaced.** The root-signed grant names the device key and the sync device ID together; sync history is never rewritten.
- **No vault-key rotation on removal.** It needs all sync data re-encrypted. Removal instead refuses the key forever, ends the device's session and sync identity, and gossip only spreads removals (see the brief).
- **Discovery** is server candidates fed at dial time, cached addresses and mDNS (blinded IDs); iroh's own address-lookup hook was not used because the macOS transport runs in a separate helper.
- **Run grants are required for every device context**, including on the device itself, and pending devices get no agent work, per the brief.
- **Device channel tickets** are one-use rows (`device_channel_tickets`), so any API process can accept the socket.
- **Cross-language check:** `server/test/contract/http/api/testdata/device_records.json` holds records signed by the app's Rust code (regenerate with `MISTY_WRITE_DEVICE_FIXTURE=<path> cargo test --lib device_record_fixture`); the server's parsers verify every one.
- **Native against a real server:** with a server built from this checkout running, `MISTY_DEVICE_SERVER=http://127.0.0.1:8099/v1 cargo test --lib device_server_e2e -- --ignored` drives the app's own code for two devices of one account: registration with key proofs, self-admission with the vault root, approval from the first device with matching codes and a sealed vault root, the native channel client (presence, LAN-only candidates, connect intents), names, a denied request, and removal (the removed device is told and can never register again).
- **LAN end to end:** `cargo test --lib e2e_tests -- --ignored` runs two transport workers on one machine's network, including an agent file delivery and its refusals.
- **Measured (Phase 2 load test, `MISTY_DEVICE_LOAD_TEST=5000`, one Mac, local Postgres):** 5,000 authenticated sockets opened in about 10s; about 52 KB heap per socket (client and server in one process); over 65s idle, 0 device-table writes, 0 cross-process notifications, and one liveness statement per 45s updating 5,000 rows. A lone API process sends no notifications; with several, presence is re-announced in batches of 30.

Each phase ships on its own, leaves the app working, and lists its security checks, server load budget and tests. Phases 0–4 are the core. Phases 5–6 build on them. Phase 7 is optional.

## Current state

| Concern | Today | Problem |
|---|---|---|
| Registries | `trusted_devices` (agents, Connected Devices) and `browser_sync_devices` (sync) | The same machine is registered twice, under different keys and IDs |
| Agent device key | Generated in the webview with WebCrypto as an extractable key ([useAgentDeviceStore.ts:275](../../src/features/agents/store/useAgentDeviceStore.ts#L275)), stored in the keychain, then read back into the webview to sign ([useAgentDeviceStore.ts:223](../../src/features/agents/store/useAgentDeviceStore.ts#L223)) | Any script injected into the main webview can steal it |
| Device registration | `RegisterDevice` admits any public key on the strength of a session alone ([agents_device_authenticated.go:70](../../server/internal/platform/httpapi/agents_device_authenticated.go#L70)) | A stolen session can mint a trusted device, which can then receive agent jobs and start Connected Devices pairing |
| Peer trust root | Server-signed peer tickets, with the server's key pinned in the client ([connected_devices.go:303](../../server/internal/platform/httpapi/connected_devices.go#L303), [connected_devices.rs:2119](../../src-tauri/src/infra/connected_devices.rs#L2119)) | A compromised server can mint peer access |
| Peer consent | File-write and clipboard consent are server rows (`SetDevicePairFileWrites`, `SetDevicePairClipboardConsent`), pushed to native through `sync_pairs` | The server can switch on write access to a disk |
| Presence | Connected Devices HTTP poll every 30s writes `device_presence` ([useConnectedDevices.ts:38](../../src/features/connected-devices/useConnectedDevices.ts#L38)). Agent heartbeat writes `trusted_devices.last_seen_at`. The sync socket keeps its own liveness. | Three presence systems, two of them writing to the database on every beat |
| Signed device requests | Each signed HTTP request writes a nonce row (`ConsumeTrustedDeviceNonce`) | One database write per request |
| Addresses | `device_presence.addressing`, refreshed only on the 30s poll | Stale for up to 30s after a network change |

Strengths to keep:
- Sync's vault root signature over device grants is already the client-only verifier ([crypto.rs:218](../../src-tauri/crates/browser-sync/src/crypto.rs#L218), checked by `EnrollBrowserSyncDevice` in [store.go](../../server/internal/sync/store.go)).
- The LAN guard before and after connecting (`is_lan_address`, [connected_devices.rs:1110](../../src-tauri/src/infra/connected_devices.rs#L1110)).
- Sync liveness's single periodic write per process ([liveness.go](../../server/internal/sync/liveness.go)).
- The existing device job queue with assigned devices and leases.

## Phase 0 — Close today's gaps (independent of the redesign)

1. **Move the agent device key into native code.**
   - Add Rust commands that generate the key, return the public key, and sign a canonical request (method, path, timestamp, nonce, body digest).
   - Mark the key non-extractable in practice: there is no command that returns it.
   - Migrate the existing keychain entry in place, and remove the webview's import, export and sign paths.
2. **Make write and clipboard consent local.** Native keeps its own copy of the consent set on this device's UI. When a server value is more permissive than the local copy, native ignores it and logs it. Phase 5 replaces this with signed policy.
3. **Require an existing vault-enrolled device for agent device registration**, when the account has a vault. This is an interim measure; Phase 3 makes it universal.

Tests:
- A unit test that no Tauri command returns private key bytes.
- A native test that a server consent payload enabling writes is ignored until enabled locally.
- A server DB test (`server/test.sh`) that registration without the interim proof is refused.

## Phase 1 — One device identity

**Native**
- Add `infra/device_identity.rs`, using keychain service `com.misty.device-identity` and an Ed25519 seed. It exposes:
  - `public_key()`
  - `sign(domain, bytes)`, where `domain` is an allow-listed enum, never a free string from the webview
  - `iroh_secret_key()`, built from the same seed
- `agent_device_identity.rs` and the Connected Devices secret are migrated onto it.

**Server**
- New goose migration adds `devices`:
  - `id`, `account_id`, `public_key` (unique)
  - `name`, `platform`, `os_version`, `app_version`
  - `state` (`pending`, `admitted` or `revoked`)
  - `admitted_at`, `approved_by_device_id`, `grant_epoch`, `grant_signature`
  - `legacy_sync_device_id`, `legacy_trusted_device_id`
  - `created_at`, `last_seen_at`
- `last_seen_at` is coarse, rounded to 5 minutes.

**Migration**
- Keys cannot be merged without proof. On the first launch with an unlocked vault, the client signs a v2 grant that names its legacy IDs, and the server links them.
- Devices without a vault remain `pending` until admitted.
- Old tables stay readable until no linked row remains, then a later migration drops them.

**Frozen names**
- Sync `DeviceGrant` v1 bytes and the `device_id` inside signed mutations stay as they are. The device row keeps `legacy_sync_device_id` as its sync signer ID.
- New devices use one ID for both.
- History is never rewritten.

Go files in `server/internal` are often CRLF, so scripted edits must preserve line endings.

## Phase 2 — Control channel

**Endpoint:** `GET /api/devices/channel` (WebSocket).

**Authentication**
1. The session cookie identifies the account.
2. The server sends a 32-byte nonce.
3. The device signs `("misty.device.channel.v1", account_id, device_id, server_instance_id, nonce)`.

This is verified in memory, with no nonce table write. It allows one socket per device; a new one closes the old. Pending devices may connect, but receive only admission messages.

**Messages:** versioned JSON, 16 KB maximum per frame.
- `hello`
- `presence.snapshot` and `presence.delta`
- `address.update`
- `connect.intent`, answered with `connect.candidates` sent to both devices
- `devicelist.updated` and `policy.updated`
- `job.available` (a hint only; claiming stays the existing leased database operation)
- `revoked`

**Presence**
- In memory per API process. The database is written only on state change, coalesced, plus one lease-renewal batch per process (the sync liveness pattern).
- Fan-out across processes uses the existing account change topics (Postgres LISTEN/NOTIFY). Today one VPS runs one process, so that path is the fallback.

**Limits**

| Limit | Value |
|---|---|
| Admitted devices per account | 20 |
| Sockets per device / per account | 1 / 30 |
| Debounce on address changes (on device) | 2s settle |
| `address.update` | ≤ 1 per 2s, ≤ 60 per hour per device |
| `connect.intent` | ≤ 10 per minute per device pair |
| Candidates per device | 8 |

Abuse beyond these limits closes the socket, with backoff before reconnecting.

**Keepalive:** WebSocket ping every 30s, no database touch. Online means the socket is open.

**Server load budget**

| Event | Server cost |
|---|---|
| Idle device | One ping frame every 30s, no database work |
| Address change | One ≤1 KB frame in, one per online peer out, one coalesced write |
| Connect intent | Two ≤1 KB frames out, no database work |
| File transfer | Zero |

This retires the 30s `device_presence` poll, the agent heartbeat and the per-request nonce writes for operations that move to the channel. It is a net reduction in requests and database writes.

**Client**
- Reconnect with full jitter (1s doubling to 60s).
- On reconnect, resend current addresses and request a presence snapshot.

Tests:
- Server: forged or replayed challenge refused; a pending device receives no presence or candidates; a second socket closes the first; rate limits close abusive sockets.
- Load test on the [load_test.go](../../server/internal/sync/load_test.go) pattern: 5,000 idle sockets, zero database writes per ping, memory per socket measured and recorded here.

## Phase 3 — Admission ("add once")

**States:** pending → admitted → revoked.

**Path A (password and secret).** Reuse `SyncVaultForm` re-enroll. The device derives the root key and signs grant v2:

`("misty.device.grant.v2", account_id, vault_id, device_id, key_epoch, device_public_key, issued_at, approved_by_device_id)`

**Path B (approve from a device you already have)**
1. The new device posts an approval request with its public key and a fresh X25519 key bound by its device signature.
2. Both screens show a six-digit code derived from (new device public key, request nonce, vault ID).
3. On a match, the approver signs grant v2 and seals the root key to the X25519 key (HPKE).
4. The server relays only the ciphertext. Requests expire after 10 minutes, and each request has one approval attempt.

**Signed device list v1**

`("misty.device.list.v1", account_id, vault_id, list_version, key_epoch, admitted[{device_id, public_key}], revoked[device_id], issued_at)`

A root holder signs it on every admission and removal.

**Server checks**
- The session account matches.
- The grant verifies against `root_public_key`, and its epoch is current.
- The public key is unused anywhere else.
- `list_version` is exactly the previous version + 1 and verifies.

Admission gates presence, candidates, connect intents, agent device contexts and job claims, everywhere.

**Client checks**
- Every list verifies against the pinned root public key.
- Versions only move forward.
- A list that fails verification is reported in text, and the device keeps its last good list.

Tests:
- A grant signed by the wrong root is refused.
- A replayed approval code is refused.
- A tampered list is refused by both server and client.
- A pending device cannot claim jobs or receive candidates.
- An approval with a mismatched code cannot complete.

## Phase 4 — LAN data channel on the unified identity

**Endpoint and discovery**
- The iroh endpoint uses the device key.
- Implement iroh's discovery (address lookup) hook backed by `connect.candidates`.
- Enable mDNS local discovery and cached last-known addresses alongside it, tried in parallel. The first verified connection wins.

**Accepting a connection**
- The remote key must be in the current verified list, not revoked, and the list must be within its 24-hour freshness window.
- Each protocol (files, clipboard, media, agent transfer) is checked against the local signed policy.
- Keep the selected-path LAN check.

**Handshake.** Exchange list versions, and fetch and adopt a newer list when it verifies.

**Network changes**
- Rely on iroh's multipath connections to move.
- When a connection drops, redial with jitter (1s doubling to 30s) after fresh candidates arrive.
- Confirm transfers resume by offset, and add resumption where they do not.

**Network decision.** Use the same-network rule from the brief (IPv4 public match, IPv6 /64, overlay range). Report the dial result as text: Same network, Other network, or Can't reach.

**Remove for same-account devices**
- Pairing dialog, pairing sessions and tickets
- Per-pair session tokens
- `files.device_session_days` and its setting
- The server ticket signing key

Pairing with another person's account is out of scope.

Tests:
- A connection from a key not in the list is refused.
- A revoked device is disconnected within 5s of a peer seeing the new list.
- A server candidate pointing at a different key fails.
- A public-range candidate is never dialed.
- An offline device still connects to a peer on the same LAN using mDNS and cached data within the freshness window.

## Phase 5 — Signed permissions and device management

**Policy record**

`("misty.device.policy.v1", device_id, policy_version, files: off|view|edit, clipboard, agent_surfaces[], issued_at)`

- Signed by the owning device, verified by the server and fanned out.
- The owning device enforces only its own copy.
- Phase 0's local consent copy migrates into it.

**Rename.** Any admitted device can rename any device. The server validates 1–64 characters with no control characters, then fans the change out. Names from `trusted_devices`, `browser_sync_devices` and pair nicknames merge into `devices.name`, preferring the most recently edited.

**Settings → Devices.** Build it per the brief. Register it in [settingsRegistry.tsx](../../src/features/settings/settingsRegistry.tsx), replacing File sharing and keeping the `devices` id and icon. Redirect old File sharing search targets. Sync's Workspace devices section reads the same records.

**Remove device**
1. A root holder signs a new list with the device revoked.
2. The sync key epoch rotates.
3. The server closes the device's channel and cancels its queued jobs.

Status uses the shared monochrome treatment, and all copy states consequences in text.

Tests:
- A policy signed by another device is refused.
- A server-altered policy is ignored by its owner.
- Controls for another device render read-only with "Change this on <name>".
- Rename shows pending, error and acknowledged states.
- Removal ends every channel and connection for that device.

## Phase 6 — Agents across devices

1. **Advertise surfaces.** Devices advertise agent surfaces in their policy record. The server offers a device's contexts only when they are in its current policy.
2. **Device picker.** The Agents composer gets a device picker listing admitted devices, with a text status label and "Waiting for <name>" while a run is in `awaiting_device`.
3. **Run grants.** The requesting device signs `("misty.device.run-grant.v1", run_id, target_device_id, agent_id, capabilities[], expires_at)`, with a 24-hour maximum. `QueueWorkflowDeviceNodeJob` requires a valid grant for any target other than the requesting device. The target verifies the grant and its own policy on every job.
4. **Transfer jobs.** "Send F to device A" runs as a LAN transfer. The job result is a receipt `{sha256, size, destination}` and never file bytes.
5. **Read caps.** Results returned to the runtime for file reads are capped at 64 KB per call and 1 MB per run. Beyond that, the agent must narrow the read. This bounds both server bandwidth and what reaches the model.

Tests:
- A job for device B without a run grant is refused.
- A grant for capability X cannot run Y.
- An expired grant is refused.
- A transfer job never sends payload bytes through the server.
- Read caps are enforced.

## Phase 7 (optional) — Fold sync onto the channel

Run the sync protocol as a sub-channel of the device socket (one socket per device instead of two). Consider a LAN fast path where online peers on the same network exchange sync ciphertext directly, with the server mailbox catching up the others. Both need a sync protocol version bump; names inside signed bytes stay frozen.

## Rollout

- Production is hosted-only, released from the Mac, with local `.githooks` checks and no CI. Each phase ships as one release.
- Clients advertise `misty-device/2`. The server keeps v1 Connected Devices and agent registration paths until every linked device has moved, then removes them in a cleanup release.
- Contract tests for the security properties live under `src/tests/contracts`. Server DB tests run through `server/test.sh`.
- Record measured socket memory, frames per hour per idle device, and database writes per hour in this file after the Phase 2 load test.
