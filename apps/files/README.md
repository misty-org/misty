# Files

`index.tsx` is this app's SDK component entry. The adjacent folders own its file workspace and previews, including their colocated tests.

From the misty-apps repository, run:

```sh
npm run build:apps -- files
```

The host's shared build tooling writes `.build/official-apps/files/desktop/app.js` and `app.css`. Reload dev desktop to load the rebuilt component directly.

Shared UI, API adapters, and native infrastructure remain in the adjacent Misty host. Build aliases preserve those imports and use the host's dependency versions. This source checkout is not yet a standalone SDK-only package.

Files composes `misty.fileSystem.mountWorkspace` for both Explorer and Transfers.
This shared workspace is the original full desktop UI, including split panes,
previews, connected disks, QR-paired devices, and the native SQLite transfer
history. Its implementation is retained under `workspace/explorer`; shared host
contexts supply the existing device and workspace services. Do not replace it
with `SdkFilesWorkspaceView` or a per-view transfer list.

Native operations are also available independently through `misty.fileSystem`
(e.g. `listDirectory`, `queueTransfer`, `transfers`, `pause`, `resume`). They use
installation scopes and the existing Rust IPC services. They do not request an
additional folder grant. The older handle-based `misty.files` API remains for
apps that explicitly use chosen-file handles.
