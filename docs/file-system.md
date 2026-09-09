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

A component app can compose Misty's complete reusable workspace:

```ts
const workspace = await misty.fileSystem.mountWorkspace(root, {view: "explorer"});
workspace.update({view: "transfers"});
workspace.unmount();
```

The complete workspace requires `files.read`, `files.write`, `connections.read`,
`connections.write`, and `navigation.write`. It includes the original file
explorer, split panes, previews, device controls, and transfer history. Its UI is
shared host infrastructure; the app package controls its placement and selected
view. Mount inside the component's own root. One workspace can be mounted per
component view, and it closes automatically with that view's session.

Native file commands work through the desktop RPC transport. Mounting the shared
workspace requires a component host supporting `mountFileWorkspace`; older hosts
return an update requirement. The existing chosen-handle API (`misty.files`) is
separate and remains available for apps that use individual file grants.
