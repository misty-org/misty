# Desktop Files and Transfers

`misty.fileSystem` provides the existing native desktop filesystem and transfer
services. Local folders, mounted disks, connected storage, and paired-device
paths use the same Rust services as Misty's file explorer. Transfers are the
native operation queue and its SQLite history, shared across tabs and surviving
view closure.

The host enforces the app's installed `files.read` and `files.write` scopes.
Device discovery additionally requires `connections.read`. There is no second
folder-selection permission prompt for this API. OS filesystem restrictions
still apply.

```ts
const listing = await misty.fileSystem.listDirectory({
  path: "/Users/me/Documents", showHidden: false,
});
const queue = await misty.fileSystem.queueTransfer({
  sources: [{path: "/Users/me/Documents/report.pdf", isDirectory: false,
    sizeBytes: null, remoteModified: null}],
  destinationDirectory: "/Users/me/Downloads",
  operation: "copy",
});
const history = await misty.fileSystem.transfers({limit: 50});
```

Files owns its complete workspace in its downloadable component package. The
host supplies native services and generic selection/preview primitives; it does
not render Explorer or Transfers on behalf of the package.

`fileSystem.mountWorkspace` is deprecated and rejected by new hosts. Update old
Files packages rather than relying on a bundled fallback. The typed native
operations above remain compatible.

The chosen-handle API (`misty.files`) supports package-owned workspaces:

```ts
const location = await misty.files.resolveLocation("/Users/me/Documents");
// Resolve a destination into its configured source identity and relative path.
// Unavailable destinations return { unavailable: true }.
const url = await misty.files.previewUrl(ownedFileHandle);
// Use this host-resolved URL for audio/video playback without buffering the file.
const thumbnail = await misty.files.previewImage(ownedFileHandle, 256);
```

Both preview methods validate the owning app instance and `files.read` scope.
File paths remain resolved in the host. `restoreLocation()` is retained to adopt
legacy Files tab state; new explicit navigation uses `resolveLocation(path)`.
Workspace state and Files transfer presentation belong to the package. Native
SQLite transfer history is preserved and queried through `fileSystem.transfers`.
