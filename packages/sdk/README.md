# Misty app SDK

See [native personal agents](docs/native-agents.md) for agent identity contracts, configured integration discovery, and host-owned execution.

Public-facing packages for apps running inside the Misty host. The host provides transport, scoped identity and capabilities; apps do not receive account credentials.

- `@misty/contracts`: named methods and method-specific request/response validation.
- `@misty/sdk`: component lifecycle and typed app clients, using an injected host transport.

From the Misty repository root, run `misty setup` and `misty sdk check`. Public packages build without the Misty app or private server source. Version 0.1.0 is distributed as GitHub release archives; npm publication is deferred. Install both archives together: `npm install ./misty-contracts-0.1.0.tgz ./misty-sdk-0.1.0.tgz`. Run `npm run sdk:packed` to verify them in an isolated consumer. Billing, account administration and direct external-client authentication are outside this SDK.

Journal collaboration uses host-owned connections. `misty.collaboration.open/send/close` exchanges bounded binary frames and scoped events; components never receive join tickets or server addresses. For Yjs, use the optional import below (its provider is excluded from apps that do not import it):

```ts
import { connectMistyYjs } from '@misty/sdk/yjs';
import * as Y from 'yjs';

const doc = new Y.Doc();
const session = await connectMistyYjs(misty.collaboration, {
  resource: 'note',
  resourceId: noteId,
  doc,
  signal, // supplied to the component's mount function
});
// Bind session.provider/doc to the editor. Respect session.role for editing UI.
// Server room authorization still enforces document access and write roles.
// When the document closes:
session.destroy();
doc.destroy();
```

Aborting the component lifetime also destroys the provider and stops reconnecting. Cross-tab BroadcastChannel synchronization is disabled. The deprecated `collaboration.createTicket` helper is unavailable to downloaded components; the host uses the corresponding HTTP method privately when opening a leased connection.

Journal attachments use a bounded host transfer rather than exposing signed storage URLs:

```ts
const asset = await misty.journal.assets.upload({
  resource: 'note', resourceId: noteId, filename: image.name, file: image,
});
// Store asset.id in the shared document, not the downloaded bytes or a signed URL.
const { file } = await misty.journal.assets.download({
  resource: 'note', resourceId: noteId, assetId: asset.id,
});
const imageUrl = URL.createObjectURL(file);
// Revoke imageUrl when the image or view closes.
```

Uploads and downloads support the server's passive raster image formats, up to 15 MiB per file. The SDK uses 256 KiB chunks; the host allows two transfers per mounted view, verifies size/SHA256 and cancels outstanding work when that view's session closes. Drawings also supply `externalFileId` on upload. Low-level reserve/finalize/download descriptors belong to the host and are rejected at the downloaded-component boundary. `misty.data.subscribe('notes' | 'drawings', refresh)` receives scoped invalidation signals for list updates.


Downloaded editors can register a surface with `misty.surfaces.register(adapter)`, read or subscribe to `misty.ai` snapshots, and invoke a registered action with `misty.ai.runAction(actionId, selectionHash)`. Proposal decisions use `misty.ai.decideProposal(proposalId, decision)`; the host verifies the active view, artifact owner and current selection. These are local host controls, not new HTTP routes.

`misty.clipboard.writeImage(pngBlob)` copies a PNG to the device clipboard using the revocable `clipboard.write` grant. PNG data is limited to 4 MiB; macOS also validates decoded dimensions and memory. The component never receives shared clipboard credentials. Other image formats should be rendered to PNG before calling this method.


`misty.clipboard.readImage()` returns a bounded PNG `Blob`, or `null` if the local clipboard has no image, through the revocable `clipboard.read` grant. It does not read another device's clipboard.

Collaborative downloaded components use the host's optional `libraries.yjs` module (Yjs 13) alongside its React libraries. Build the `yjs` import as an external library bound to this module; create each document and provider inside the component's own lifetime. This shares constructors to avoid incompatible duplicate Yjs imports, while keeping document/account state private to the mount.

Inbox uses eight typed `misty.server.call` contracts: `mail.accounts.list`, `mail.folders.list`, `mail.threads.list/get/action`, and `mail.drafts.create/update/send`. Provider thread/draft IDs are opaque and encoded exactly once by the host; account connection IDs remain strict identifiers. Read, archive and star are the supported thread actions. Sending requires `confirmed: true` and an explicit `authoring_source`; an AI-generated draft must still be reviewed and sent by the user. Draft text and decoded attachments together are limited to 10 MiB. Server handlers still enforce ownership, grants and provider limits.

`misty.mail.cache.read/write/clear` persists a bounded, encrypted offline Inbox snapshot through the host. It is not an HTTP endpoint. Cache access requires `mail.read` plus the corresponding `storage.read` or `storage.write` grant. The host supplies the account, deployment, App and Space namespace and encryption material; components cannot select another cache owner or obtain its key, native path or authentication token. Account/view closure cancels in-flight delivery. Connection metadata and authorization remain available through `connections.list/authorize`; `connections.remove` requires `connections.write` and deletes only a connection owned by the signed-in account.

The Files/Code foundation now supports directory capabilities:

```ts
const folder = await misty.files.pickDirectory();
if (folder) {
  const page = await misty.files.listDirectory(folder.handle, { limit: 100 });
  const firstFile = page.entries.find(entry => entry.kind === 'file');
  if (firstFile) {
    const file = await misty.files.openEntry(folder.handle, firstFile.entry);
    try { const text = await misty.files.readText(file.handle); }
    finally { await misty.files.release(file.handle); }
  }
  await misty.files.release(folder.handle);
}
```

Pass the returned `entry` token unchanged; `name` is for display. Tokens preserve native names without passing absolute paths. Listings use native directory order, at most 200 entries per page, and `nextOffset` is null at the end. If the directory changes, refresh from offset zero. `openEntry` returns an independent file or subfolder capability; release each handle when finished. Opening for writes requires `{write: true}`, a folder previously picked for writing, and the live `files.write` grant. Symlinks and special files are listed but cannot be opened this way; choose their intended target explicitly. These two device methods add no HTTP routes. Full Files/Code UI migration remains in progress.

`files.readText` and `files.writeText` support up to **5 MiB of UTF-8 bytes**, matching the native Code editor. Both use an App-owned handle; writing also requires a writable grant. The SDK validates requests and replies, and the host independently checks the byte limit before truncating a write target. Writes replace contents through the granted file descriptor; they do not provide atomic replacement or conflict detection, and an I/O failure can leave a partial write. Clipboard text retains its separate 256 KiB limit.

`misty.code.lsp` starts a configured local language server, sends bounded JSON-RPC 2.0 payload strings, subscribes to `message`/`exit` events, and stops the owned process. `start(language, cwd)` returns `{handle}`; use this opaque handle for subsequent calls. Supported canonical languages include TypeScript/JavaScript, Rust, Python, Go, C/C++, YAML, JSON, HTML, CSS, Bash, Lua, Zig and Tailwind. The host must have the corresponding language-server executable installed. Messages are limited to 8 MiB and each view to eight processes; closing the view terminates them.

Language-server methods require **`code.execute`**, which allows running configured local development processes. This is separate from read/write file grants and does not sandbox those processes to the supplied absolute working folder. The host selects the executable and arguments; apps cannot supply an executable or native process ID. There are no additional HTTP routes. The full Code application migration remains unfinished.

For folders selected with `{write: true}`, `files.createEntry(directory, name, 'file' | 'directory')` creates an empty child and returns its entry token. `files.renameEntry(directory, entry, name)` renames within that same folder without replacing an existing destination (macOS). `files.removeEntry(directory, entry, {recursive: true})` permanently removes a nonempty directory; the default only removes files, links or empty directories. Symlinks are unlinked without traversing their targets. All three require `files.write`. Release folder/file handles when finished. Queued operations are rejected after folder release; an already-started filesystem mutation may finish, and recursive removal can be partial on failure. These are host-only operations and add no HTTP routes.


The same file grants support native previews and edited binary files:

- `files.openTrash()` opens a persistent writable Trash folder private to this installed app/account/Space on macOS. It requires `files.write` and returns an owned directory handle; no caller-supplied path or owner is accepted. Use the existing directory/transfer methods to store recovery metadata and move or restore entries. Releasing the handle or closing a view leaves the contents intact. This is Misty's app-owned Trash, not ambient access to the operating system's Trash.
- `files.listArchive(handle, format)` inspects up to 500 entries without extracting files. Use `zip`, `tar` (including compressed TAR), `7z` or `rar`. ZIP is native; macOS TAR uses the system reader, while 7z/RAR need their installed readers. System readers operate on a private snapshot under Misty's native sandbox. Returned archive paths are display labels, not file-grant tokens. Releasing the input or closing/revoking the app cancels its read.
- `files.replaceCopy(draftHandle, targetFileHandle)` writes a fully staged `createCopy`/`appendCopy` output into an owned writable file, preserving its identity and consuming the draft on success. It requires `files.write`. This is an in-place write; an I/O failure can leave partial changes and should remain visible to the user. `commitCopy` instead creates a separate file without overwriting the original.
- `files.openExternal(handle)` opens the chosen file in its native application on macOS. It requires the separately declared and granted `files.open` capability. Callers never supply an absolute path or application command.

On macOS, a granted folder can be saved for a later app session. Saved IDs belong to the same app installation, account and Space; they are not filesystem paths. Listing requires `files.read`. Reopening requests fresh view-owned access, and a saved read-only folder cannot be reopened writable.

```ts
const folder = await misty.files.pickDirectory({ write: true });
if (folder) {
  const saved = await misty.files.rememberDirectory(folder.handle, { write: true });
  await misty.files.release(folder.handle);
  const recent = await misty.files.listSavedDirectories(); // at most 32 public receipts
  const reopened = await misty.files.reopenDirectory(saved.bookmarkId, { write: true });
  // Use reopened.handle with the directory/file methods, then release it.
  await misty.files.release(reopened.handle);
  await misty.files.forgetDirectory(saved.bookmarkId);
}
```

Forgetting removes future saved access while already-open grants remain valid until released or revoked. Saving/reopening currently supports directly mounted local APFS/HFS+ volumes in Misty's macOS desktop distribution. Apps should still allow session-only use if saving fails, and offer folder selection when a saved volume or directory is unavailable. The host stores private directory identity in the OS credential vault; the SDK only returns `bookmarkId`, `name` and `writable`. It does not use Apple's App Sandbox security-scoped URL bookmark lifecycle.


Code uses `misty.code.lsp` with owned folder grants. `misty.code.rewrite` delegates model access to the host; the component never receives model credentials. `misty.code.cancelRewrite` cancels a request belonging to that view. Code preferences, model settings and Terminal placement use the scoped `misty.code` controls. These controls are restricted to the official Code app for v0.1.0.

Editors call `misty.workspace.setUnsavedChanges(true)` while they have unsaved buffers and clear it after saving. Misty keeps executing app versions fixed until their views close; package and host updates require an explicit install action after closing app tabs.

### Capability execution helpers

`misty.capabilities.discoverAll()` iterates every authorized provider page. Use
`invokeAndWait(invocation, { signal })` to submit a stable `requestId` and observe
its result. It returns when work completes or needs approval, a device, or user
intervention; it never grants approval itself. Reuse the original request ID when
recovering a lost response.

`waitForResult(requestId, { deadline, signal })` observes existing work without
resubmitting it. Its abort signal stops observation only. Aborting
`invokeAndWait` requests cancellation of the admitted work. A cancellation
request or polling timeout does not prove that an external effect stopped: read
the saved result and preserve `uncertain`, partial, and waiting outcomes.
