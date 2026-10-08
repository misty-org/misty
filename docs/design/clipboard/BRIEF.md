# Clipboard: approved direction

Approved direction (October 7, 2026). This brief extends [docs/design/devices/BRIEF.md](../devices/BRIEF.md), whose Rule 1 it amends. It uses the sync vocabulary: account → vault → devices.

## Goal

What you copy on one admitted Misty device can be pasted on your others, wherever they are. The clipboard reaches devices over the internet, not only the LAN, and nobody but your devices can read it.

## Rules

1. **Clips are end-to-end encrypted.** A clip is sealed on the device with a key derived from the vault root. Misty's server and Cloudflare only ever hold ciphertext.
2. **Cloudflare carries clips, the VPS does not.** A Cloudflare Worker stores ciphertext in R2, keeps each account's recent clips in a Durable Object, and serves blobs from the edge cache. The Misty API only mints short tickets.
3. **Every copy publishes.** When the Clipboard control is on for a device, every change to its system clipboard is published, files included, up to the size cap. The Clipboard control in Settings → Devices is the off switch, and it covers both the LAN fast path and the cloud.
4. **The LAN stays a fast path.** Devices on the same network still offer clips to each other directly over iroh. The `(revision, source device)` clock drops a clip that arrives both ways.
5. **Kura has no account.** Kura, the standalone file manager, reaches the clipboard only through the Misty app running on the same machine, and only after the person allows it in Misty.

## What a clip holds

| Kind | Notes |
|---|---|
| Text, links and HTML | Up to 1 MiB of text |
| Image | PNG, up to 10 MiB |
| Files | Regular files and folders (folders are zipped), 25 MB total per clip. Above the cap the clip carries only the file names, as text. |

- **Retention.** Clips expire after 24 hours, and an account keeps at most its 20 most recent clips. R2 objects are removed by a one-day lifecycle rule.
- **Caps per account.** 25 MB per clip and 200 MB uploaded per day. Over the cap, publishing pauses until the day resets, and the popover says so in text.

## Crypto

- The clip key is derived from the vault root (`VaultRoot::clipboard_key`, domain `misty.clipboard.key.v1`, bound to the deployment, account and vault). It exists only in native memory while the vault is open on the device, which happens on its own when the device remembers its vault key. While the vault is locked the popover says so and only the LAN path works. The webview never receives the key.
- Each part (the manifest body and each blob) is sealed with AES-256-GCM. The associated data names the domain `misty.clipboard.part.v1`, the account, the clip ID and the part index, so a part cannot be moved to another clip or account.
- Blobs are addressed by the SHA-256 of their ciphertext.
- Revoking a device ends its session and its tickets. As in the Devices brief, a removed device that kept the vault key can still derive the clip key until vault key rotation lands. It has no way to get a ticket, so it cannot fetch new clips.

## Cloudflare

**Tickets.** `POST /v1/clipboard/ticket` on the Misty API returns an Ed25519-signed ticket (`aud = misty-clipboard`, account, device, short expiry). It is issued only to a device-signed request from an admitted device whose signed policy has the clipboard on. The Worker holds only the public key, the same way journal collaboration works.

**Worker `misty-clipboard`.**

- `ClipboardRoom` is a SQLite Durable Object, one per account. It keeps the clip ring. Each entry holds the clip ID, revision, source device, total size, blob hashes, expiry and the encrypted manifest body. It pushes new entries to the account's devices over hibernating WebSockets, and an alarm prunes expired entries.
- `PUT /blob/{sha256}` checks the ticket and the hash, then writes the ciphertext to R2 under the account.
- `GET /blob/{sha256}` checks the ticket first, then serves from the edge cache (keyed by account and hash, immutable, one day), and falls back to R2. Responses to clients are `private`.
- Content-addressed ciphertext is the only thing cached, so caching at the edge reveals nothing.

## Surfaces

**Misty.** The browser toolbar has a monochrome Clipboard button. Its popover lists recent clips: device name, kind, size and time, in text.

- Clicking a clip copies it to this device's clipboard.
- A file clip also offers Save to Downloads.
- The first load shows a skeleton list.
- When the clipboard is off for this device, the popover says so and links to Settings → Devices.

**Kura.** The sidebar has a Clipboard section with the same list and a Paste here action for the current folder.

- Without Misty running, it says "Open Misty and sign in to share your clipboard across devices".
- Copy and paste inside Kura need nothing from Misty, because Misty syncs the system clipboard on its own.

## Kura bridge

- Misty listens on a user-only local socket. On macOS this is a Unix socket in a 0700 directory under Misty's application support folder; on Windows it is a named pipe restricted to the current user.
- Requests are JSON lines: `hello`, `list`, `subscribe`, `copy`, `materialize` (write a clip's files into a folder Kura names).
- The first `hello` from Kura asks in Misty: "Allow Kura to use your Misty clipboard?" Allowing it stores a token in the keychain. The person can revoke it in Settings → Devices.
- The bridge never exposes keys, tickets or account data. Only clip content that this device could already paste crosses the bridge.

## Threats and answers

| Threat | Answer |
|---|---|
| Compromised server, operator or Cloudflare | Sees ciphertext, sizes and timing only. Cannot forge tickets without the API key, and cannot decrypt. |
| Stolen session cookie | Registers a pending device only. Pending devices get no ticket. |
| Swapped or replayed blob | Hash-checked on upload and download. The associated data binds each part to its account, clip and index. |
| Another local app impersonates Kura | The socket is user-only and needs an approved token. It can read only what a paste could already read. |
| Password manager copies | Published like any copy, per the person's choice. Turning the Clipboard control off stops it on that device. |
