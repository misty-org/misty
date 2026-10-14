# Drop the LAN layer and carry the clipboard on sync

Direction agreed 2026-10-12. This changes two approved briefs:

- `docs/design/devices/BRIEF.md` Rule 1: no LAN data plane.
- `docs/design/clipboard/BRIEF.md` Rules 2 and 4: clips travel on sync, with no Cloudflare and no LAN fast path.

Update both briefs in the same change as the code.

## Status (2026-10-13)

Phases 1, 2, 3 and 5 are in the code:

- **Phase 1, the clipboard on sync:** the `clipboard` collection lives in `crates/browser-sync` and
  `server/internal/sync`. Records expire after 24 hours and are reachable only by devices whose
  policy turns the clipboard on.
- **Phase 2, agent files:** agents deliver files through a Space's Library.
- **Phase 3, the LAN:** `iroh`, the peer-transport worker and the LAN transport are gone.
- **Phase 5, docs and ledger:** both briefs and the Windows parity ledger reflect this. The Kura
  bridge's Windows named pipe is in place (ledger S-12).

Phase 4's code is removed: the Worker, the ticket endpoint and its route. What's left is
operational. Delete the Cloudflare R2 bucket and Worker once desktop builds that publish through sync
have shipped.

The server's Postgres-backed tests for the clipboard collection still need a run with Docker
available.

## Decisions

1. **No LAN, no iroh.** Misty devices never talk to each other directly. Everything between devices
   goes through the account's server channels, and the server only ever sees ciphertext.
2. **The cloud clipboard rides on sync as a small buffer.** The Cloudflare Worker (`server/apps/clipboard`,
   R2, the `ClipboardRoom` Durable Object and the ticket endpoint) is retired.
3. **The buffer holds text and small images.** Each clip is compressed on the device, then sealed with
   the vault-derived clip key. Files cross as names only, as they already do above today's cap.
4. **Agents move files between devices through a Space's Library**, not device to device.

## What we give up

- **Copying between devices on the same network gets slower.** It now takes a server round trip.
  Sync already delivers a live hint, so expect about a second.
- **Large clips no longer cross.** Images that don't fit after compression, and files, are not shared.
  The popover says why in text.
- **Device-list gossip is gone.** A revocation now reaches devices only through the server. Devices
  still verify every signed list, so a hostile server can delay a revocation but cannot forge an
  admission.
- **The Windows firewall prompt goes away** (ledger S-10), along with all LAN discovery.

## Phase 1: clipboard on sync

Client (`src-tauri/src/infra/cloud_clipboard/`, `crates/browser-sync`):

- Add a `clipboard` collection. It is native-only and never projected to a renderer.
- **Ring:** 20 record slots, keyed by an HMAC of the slot number. Publishing writes the next slot
  with compare-and-swap. A record holds the clip ID, a `(revision, source device)` clock, kind, size,
  expiry and the sealed body.
- **Size limits:**
  - A body of 64 KiB or less goes inline in the record (the record limit is 64 KiB).
  - A larger body goes into one sync blob (256 KiB limit), referenced by the hash of its ciphertext.
- **Compress first, then seal.**
  - Text, links and HTML: zstd before AES-256-GCM. The cap after compression is 256 KiB, which
    covers roughly 1 MiB of typical text.
  - Images: re-encode, and downscale if needed, until they fit in 256 KiB. If an image still won't
    fit, publish nothing and say so in the popover.
  - Keep `misty.clipboard.part.v1` associated data: account, clip ID, part index. Add the slot so a
    sealed body cannot be moved to another slot.
- **Expiry:** readers ignore clips older than 24 hours. A publisher overwrites expired slots first.
- **Live delivery:** pushing records already raises the `browser-records` account event. Pull the
  `clipboard` collection when that hint names it.
- Keep `MAX_HISTORY = 20`, the popover, Save to Downloads (now for images only), and the Kura bridge.
  The bridge is local only and doesn't change.

Server (`server/internal/sync`):

- Add `clipboard` to `syncRecordCollections`.
- **Prune** clipboard records and their blobs after 24 hours, with a job or on write. Today blobs
  have no expiry; clipboard blobs need one.
- **Cap per account** with the existing sync rate limits. Drop the 200 MB per day Worker quota.

## Phase 2: agent file delivery through Library

- Replace `device_send_file` (`app/device_job_commands.rs`) and the `DeliverFile` LAN request.
  "Send F to device B" saves F to a Space's Library. Device B's job, or the person on device B,
  opens it from there.
- Update `deviceAgentTools.ts` and the server-side device tool that asks for a delivery. The receipt
  becomes the Library item.

## Phase 3: remove the LAN

Client:

- Remove `iroh` (`src-tauri/Cargo.toml`) and `services/peer-transport`, along with its `build.rs`
  embedding.
- Remove the `connected_devices*.rs` transport, `peer_files.rs`, `space_peer_*.rs`
  and `domain/lan.rs`. Also remove the LAN candidate and endpoint-address helpers
  in `device_channel.rs`, `connected_devices_links.rs`, `device_trust.rs` and `device_records.rs`.
- Remove the `misty://device/` branches in `app/commands.rs`, plus the picker's `peer_device`
  handling (`HostFilePicker.tsx`, `preparePickerSelections.ts`, `FileBrowserView.tsx`).
- Remove `SharedClipboardFanout` (`app/runtime.rs`). The clipboard client is the sync one only.
- **Keep** device admission, trust, signed lists and policies, run grants, device jobs and identity.
  Identity already uses `ed25519-dalek`; only comments mention iroh.
- In Settings › Devices, drop LAN status and connection-type text. The Clipboard control stays.

Server:

- Remove the `address` and `connect` frames from `devices_channel.go`, and their rate limits and
  storage.
- Keep presence, list hints, jobs and revocation.
- Drop LAN fields from policies if there are any, with a migration.

## Phase 4: retire Cloudflare

- Delete `server/apps/clipboard`, `httpapi/clipboard_ticket.go`, the route in
  `server_mount_spaces_routes.go`, and the related environment variables and secrets.
- Delete the R2 bucket and the Worker after desktop builds that publish through sync have shipped.
- Misty is in beta, so a hard cutover is fine: older builds' cloud clipboard simply stops.

## Phase 5: docs and ledger

- Rewrite the clipboard brief around sync, and amend devices brief Rule 1.
- Update `docs/plans/windows-parity-ledger.md`:
  - Remove M-12 and S-10.
  - C-1 to C-3 and C-5 are done by Phase 3.
  - S-12 (Kura bridge named pipe) stays.

## Order

Phase 1 first, so the clipboard never goes dark. Phases 2 and 3 can then land together. Phase 4
follows once the new desktop build is out. Phase 3 removes about 8k lines and the
`peer-transport` worker, and it takes the Windows LAN worker work off the parity ledger entirely.

## Tests

- Clip round trip between two devices on one vault: text, HTML and image, inline and blob.
- Ring overwrite at 21 clips.
- Expiry after 24 hours.
- A sealed body moved to another slot or account fails to open.
- An oversize image says so in text.
- A revoked device's pull is refused.
- Agent delivery lands in Library.
- `cargo tree` shows no `iroh`.
