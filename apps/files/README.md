# Files

`index.tsx` mounts the package-owned SDK workspace. Explorer, previews, file operations, persistent workspace state, and transfer presentation belong to this downloaded app. Misty does not mount a built-in Files workspace.

From misty-apps, build the package with:

```sh
npm run build:apps -- files --desktop-only
```

The host build tooling writes `.build/official-apps/files/desktop/app.js` and `app.css`. Shared stateless UI primitives and native services remain in Misty; app behavior uses scoped SDK services. The host bundle rejects rendered modules from `apps/files` and `apps/browser`.

The workspace uses `misty.files` for local, remote, and paired-device handles, and `misty.workspace` for persistent view state. Existing legacy tab locations are restored through the compatibility bridge. Switching between Explorer and Transfers retains the Explorer component and disables its shortcuts while hidden.

Transfers includes durable native SQLite history through `misty.fileSystem.transfers`, with pause, resume, cancel, retry, pagination, and history removal. SDK-owned transfer records use app-scoped persistent storage and retain their originating view's grants. Neither history is deleted or rewritten during migration.

`fileSystem.mountWorkspace` is obsolete. Older Files packages receive an update-required error instead of a built-in fallback. Host filesystem, account, download, and webview services remain available through scoped SDK interfaces. This source checkout still builds against shared Misty UI and contract sources.
