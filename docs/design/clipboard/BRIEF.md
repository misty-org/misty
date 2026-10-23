# Clipboard: approved direction

Approved direction (October 7, 2026; revised October 12, 2026: clips travel through sync instead of a Cloudflare Worker, and devices no longer offer clips to each other over the LAN). This brief extends [docs/design/devices/BRIEF.md](../devices/BRIEF.md). It uses the sync vocabulary: account → vault → devices.

## Goal

What you copy on one admitted Misty device can be pasted on your others, wherever they are, and nobody but your devices can read it.

## Rules

1. **Clips are end-to-end encrypted.** A clip is compressed, then sealed on the device with a key derived from the vault root. Misty's server only ever holds ciphertext.
2. **Clips ride on sync.** The account's sync connection carries them as a small ring of records in a `clipboard` collection. There is no separate service and no direct connection between devices.
3. **Every copy publishes.** When the Clipboard control is on for a device, every change to its system clipboard is published. The Clipboard control in Settings › Devices is the off switch, and the server refuses the ring to a device whose signed policy turns it off.
4. **Small clips only.** A clip must fit one ring record. Text and images shrink to fit; files cross as their names.
5. **Kura has no account.** Kura, the standalone file manager, reaches the clipboard only through the Misty app running on the same machine, and only after the person allows it in Misty.

## What a clip holds

| Kind | Notes |
|---|---|
| Text, links and HTML | Up to 1 MiB of text before compression. Text that still does not fit loses its HTML first, then is shortened. |
| Image | Shared as copied when it fits; otherwise re-encoded and scaled down (PNG, then JPEG) until it does. An image that cannot fit is not shared, and the clipboard menu says so. |
| Files | Their names, as text. The files themselves stay on the device. |

- **The ring.** The account keeps its 20 most recent clips, one per ring slot. A new clip takes an empty slot or the oldest one.
- **Retention.** Clips expire after 24 hours. Devices ignore expired clips, the server never serves them, and the next write tombstones them.
- **Size.** A sealed clip is at most 256 KiB, the clipboard collection's record limit.

## Crypto

- The clip key is derived from the vault root (`VaultRoot::clipboard_key`, domain `misty.clipboard.key.v1`, bound to the deployment, account and vault). It exists only in native memory while the vault is open on the device. While the vault is locked the clipboard menu says so.
- Each clip is a JSON header and its image bytes, compressed with zstd, then sealed with AES-256-GCM. The associated data names the domain `misty.clipboard.slot.v1` and the ring slot, so a sealed clip cannot be moved to another slot. Opening refuses anything that expands past 4 MiB.
- Each ring slot is a record whose key is the keyed HMAC of its slot number, so the server sees neither slot order nor which clip is newest.
- Revoking a device ends its session and sync identity, so it can no longer read or write the ring. As in the Devices brief, a removed device that kept the vault key can still derive the clip key until vault key rotation lands.

## Surfaces

**Misty.** The browser menu has a Clipboard submenu listing recent clips: device name, kind, size and time, in text.

- Clicking a clip copies it to this device's clipboard.
- An image clip also offers Save to Downloads.
- The first load shows a skeleton list.
- When the clipboard is off for this device, the menu says so and links to Settings › Devices.

**Kura.** The sidebar has a Clipboard section with the same list and a Paste here action for the current folder.

- Without Misty running, it says "Open Misty and sign in to share your clipboard across devices".
- Copy and paste inside Kura need nothing from Misty, because Misty syncs the system clipboard on its own.

## Kura bridge

- Misty listens on a user-only local socket. On macOS this is a Unix socket in a 0700 directory under Misty's application support folder; on Windows it is the named pipe `\\.\pipe\com.misty.desktop.clipboard.<user SID>`, which only that user can open and which Misty creates before anything else can claim the name.
- Requests are JSON lines: `hello`, `list`, `subscribe`, `copy`, `materialize` (write a clip into a folder Kura names).
- The first `hello` from Kura asks in Misty: "Allow Kura to use your Misty clipboard?" Allowing it stores a token in the credential store. The person can revoke it in Settings › Devices.
- The bridge never exposes keys or account data. Only clip content that this device could already paste crosses the bridge.

## Threats and answers

| Threat | Answer |
|---|---|
| Compromised server or operator | Sees ciphertext, sizes and timing only. Cannot decrypt, and cannot move a clip to another slot without it failing to open. |
| Stolen session cookie | Registers a pending device only. Pending devices have no sync identity and no ring. |
| Hostile clip from a compromised device | Refused if it does not decrypt, does not parse, or expands past 4 MiB. Images are decoded only when pasted. |
| Another local app impersonates Kura | The socket is user-only and needs an approved token. It can read only what a paste could already read. |
| Password manager copies | Published like any copy, per the person's choice. Turning the Clipboard control off stops it on that device. |
