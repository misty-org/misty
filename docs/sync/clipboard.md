# Clipboard: approved direction

Approved direction (October 7, 2026; revised October 12, 2026: clips travel through sync instead of a Cloudflare Worker, and devices no longer offer clips to each other over the LAN). This brief extends [docs/sync/devices.md](devices.md). It uses the sync vocabulary: account → vault → devices.

## Goal

What you copy on one signed-in session can be pasted on your others, wherever they are, and nobody but your sessions can read it. The shared clipboard is its own buffer: it never writes to a computer's system clipboard on its own.

## Rules

1. **Clips are end-to-end encrypted.** A clip is compressed, then sealed on the device with a key derived from the vault root. Misty's server only ever holds ciphertext.
2. **Clips ride on sync.** The account's sync connection carries them as a small ring of records in a `clipboard` collection. There is no separate service and no direct connection between devices.
3. **Every copy publishes, nothing writes back.** When the Clipboard control is on for a device, every change to its system clipboard is published. Opening the Clipboard menu or using Paste latest first takes whatever is on this computer's system clipboard into the buffer if the watcher hasn't yet, so the newest clip is always what you last copied. A clip that arrives from another device only joins the list; the system clipboard changes only when the person clicks Copy on a clip. The Clipboard control in Settings › Devices is the off switch, and the server refuses the ring to a device whose signed policy turns it off.
4. **No duplicates.** Copying what the newest clip already holds adds nothing. Copying what an older clip holds moves that clip to the top instead of adding a second one.
5. **Small clips only.** A clip must fit one ring record. Text and images shrink to fit; files cross as their names.

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

**Misty.** The browser menu's Tools has a Clipboard submenu listing recent clips: device name, kind, size and time, in text.

- Paste latest (Cmd+Option+V, Ctrl+Alt+V on Windows; rebindable in Settings › Shortcuts) types the newest text clip into the field focused in the page, without touching the system clipboard. An image newest clip can't be typed in; use Copy.
- Clicking Copy on a clip puts it on this device's clipboard.
- The list shows everything copied in the last 24 hours (at most 20 clips).
- An image clip also offers Save to Downloads.
- The first load shows a skeleton list.
- When sync is off on this computer, the menu says so and links to Settings › Sync.

## Threats and answers

| Threat | Answer |
|---|---|
| Compromised server or operator | Sees ciphertext, sizes and timing only. Cannot decrypt, and cannot move a clip to another slot without it failing to open. |
| Stolen session cookie | Can't read the ring: it needs the vault key. |
| Hostile clip from a compromised device | Refused if it does not decrypt, does not parse, or expands past 4 MiB. Images are decoded only when pasted. |
| Password manager copies | Published like any copy, per the person's choice. Turning the Clipboard control off stops it on that device. |
