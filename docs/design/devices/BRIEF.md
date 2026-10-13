# Devices — approved direction

Approved direction (October 5, 2026; amended October 12, 2026: devices no longer connect to each other directly, see [docs/plans/drop-lan-clipboard-on-sync.md](../../plans/drop-lan-clipboard-on-sync.md)). The implementation plan is [docs/plans/devices-unification.md](../../plans/devices-unification.md). This brief extends the sync vocabulary in [docs/design/sync/BRIEF.md](../sync/BRIEF.md): account → vault → devices.

## Goal

Add a device once. One secure step admits a device to sync, agents and the shared clipboard, and everything else follows from that step. A **device** is one signed-in Misty install on one physical machine.

## Rules

1. **The server never carries readable data.** Devices never connect to each other directly: everything between them goes through Misty's server, end-to-end encrypted where it carries content. The shared clipboard is a small ring of clips sealed with a key derived from the vault root and kept in sync ([docs/design/clipboard/BRIEF.md](../clipboard/BRIEF.md)). An agent that moves a file between devices saves it to a Space's Library. Browsing another device's files moved out of Misty into Kura, a separate account-free file manager.
2. **The server coordinates.** It holds device records, presence, signed permission records, job routing, revocation and the encrypted sync mailbox. It routes small control messages only.
3. **Sync records stay on the server as ciphertext.** That is what lets devices sync without being online together. The server cannot read them.
4. **Agents run on the server runtime.** What an agent reads on a device enters the model's context through the runtime. Nothing else does.

## Trust model

### Admission needs two independent proofs

| Proof | What it shows | Who checks it |
|---|---|---|
| Account proof | A valid signed-in Misty session for this account | Server |
| Vault proof | A device grant signed by the vault root key | Server and every device |

The vault root key is the client-only verifier. It is derived on a client from the sync password and secret, or held by an already enrolled device that saved its key. The server stores only the root **public** key (`browser_sync_vaults.root_public_key`), so it can verify grants but never produce one. A stolen session, a compromised server or a malicious server operator cannot add a device.

A device that has signed in but has no vault proof is **pending**. A pending device sees no presence and no other devices, and can only complete admission, with one exception: agents may work on the device itself (its shared folders and the Misty browser), under grants it signs for itself. That reaches only the computer the person is at, so it needs no vault proof. Reaching any other device, and being reached from one, needs the device added; adding the first device means setting up sync.

Two ways to admit:

- **A. On the new device:** enter the sync password and secret (today's re-enroll form). The new device derives the root key and signs its own grant.
- **B. From an existing device:** the new device shows a six-digit comparison code derived from its public key and the request nonce. The approving device shows the same code, and the person confirms they match. That defeats a server that swaps in its own key. The approving device signs the grant and seals the vault root key to the new device's key. The server relays the sealed bytes but cannot open them.

### One device key

- One Ed25519 key per device, generated and used only in native Rust and stored in the OS keychain. The webview never receives private key material.
- The root-signed grant names the device ID, this key and the device's sync identity together, so device ID, sync signer and device key cannot drift apart. Existing sync signing keys are kept and bound this way rather than replaced, so sync history is never rewritten.
- Every signature uses an explicit domain string (`misty.device.channel.v1`, `misty.device.grant.v2`, `misty.device.list.v1`, `misty.device.policy.v1`, `misty.device.run-grant.v1`), so a signature made for one purpose is never valid for another.

### Signed device list

A root key holder signs the account's device list: list version, key epoch, admitted devices with their public keys, revoked devices and issue time. Devices verify it against the root public key they pinned when they unlocked the vault, never against anything the server asserts.

- **Revocation.** Removing a device signs a new list with that device's key revoked. The server refuses that key forever, ends the device's account session and sync identity, cancels its queued jobs and closes its channel at once.
- **No rollback.** A device never adopts a list older than one it already holds, so a server that later serves an old list cannot re-admit a removed device. A server can delay delivering a removal; it cannot forge an admission.
- **Vault key rotation** is later hardening: rotating the root requires re-encrypting all sync data. Until then a removed device that kept the vault key can still derive it, but it has no session, no accepted key and no way to be re-admitted without the account password.

### Device integrity

What Misty guarantees: the device key never leaves the native process and keychain, admission needs both proofs above, and every device checks the signed list itself.

What Misty does not claim: hardware attestation that the machine is uncompromised. Desktop attestation is not uniformly available, and its keys are P-256, not Ed25519. A later hardening step can have a hardware-held key (Secure Enclave or TPM) certify the device key. This brief does not depend on it.

## Channels

| Channel | Carries | Never carries |
|---|---|---|
| Control (one WebSocket per device, server) | Presence, device list and policy updates, job hints, revocation | File contents, clipboard, media |
| Sync mailbox (server) | End-to-end encrypted sync records, including the clipboard ring | Anything the server can read |

## Permissions

- Each device signs its own **policy record**:
  - **Clipboard:** on or off. The server refuses the clipboard ring to a device whose policy turns it off.
  - **Agents:** which surfaces may be used (shared folders, Misty browser, terminal)
- The device enforces its own local copy. The server stores and forwards the record for display, but cannot change it.
- A device's permissions can be changed only on that device. Other devices show them read-only, with "Change this on <device name>".
- These are account records about a device, not device-only overrides of account settings, so they fit the server-account settings model.

### Cross-device agent work

When you ask from device A for work on device B:

- **Run grant.** Device A signs a grant naming the run, the target device, the agent, the capabilities and an expiry.
- **Check on B.** B runs a job only if it carries a valid run grant from an admitted device and the capability is allowed by both the grant and B's own policy.
- **What the server can't do.** The runtime can request less than the grant, never more, and the server cannot forge a grant.
- **High-risk capabilities** (terminal, deletes, git push, writes outside shared folders) are off by default in every device's policy.
- **Moving files.** "Send F" saves the file from B's shared folder to the conversation's Space Library, where every device can open it.

## Device management

Settings → **Devices** replaces the File sharing area. It keeps that area's `MonitorSmartphone` icon and the `devices` id, and is one scrolling page with small headers. It follows `DesktopSettingsSection`, `DesktopSettingsRow` and `SettingsControls`, the monochrome palette, and no tabs, dropdown disclosures or ampersands.

- **This device first, then the others.** Each device shows:
  - Name, with inline Rename: Enter or blur commits, with a Cancel. Any admitted device can rename any device.
  - A platform icon (Lucide, monochrome).
  - One status label: This device, Online, or Offline.
  - When it was added and which device approved it.
  - Last seen.
- **Controls** (editable only on that device itself):
  - Sync mode: Full sync or Independent workspace (existing)
  - Clipboard
  - Agents
- **Remove device.** Available on any device holding the root key. It explains that the removed device loses sync, the shared clipboard and agent access everywhere.
- **Waiting for approval.** A section that appears only while a device is pending. It shows the comparison code with Approve and Deny.
- **One name per device.** It replaces `trusted_devices.name`, `browser_sync_devices.display_name` and per-pair peer nicknames. Sync's Workspace devices section reads the same device records.

## Threats and answers

| Threat | Answer |
|---|---|
| Stolen session cookie | Can register a pending device only. No vault proof means no presence, other devices or jobs. |
| Compromised server or operator | Cannot sign grants, device lists, policies or run grants. It can delay updates, never forge them, and devices never roll back to an older list. |
| Server flips a permission | Owner devices enforce their own signed policy. The server copy is display only. |
| Server injects agent jobs | B requires a run grant signed by an admitted device, intersected with its own policy. |
| Removed device keeps a valid old grant | Signed revocation list checked by every device; the server refuses the key forever and ends its session and sync identity. |
| Script injection in the webview | Private keys live only in native code. Signing goes through narrow native commands that add their own domain prefix. |
| Replay of control auth | Challenge-response per socket with a server nonce, bound to the account, device and server instance. |
| Control channel spam | Per-device rate limits; unknown frames are refused. |
