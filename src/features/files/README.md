# Files

This directory contains Misty's built-in file browser, previews, file operations, including colocated tests. Its component entry and workspace code compile into Misty; they have no separate installation or update lifecycle.

Each Files tab shows one file pane, with optional navigation and preview sidebars. Transfers opens from the expandable Files group in the global navigator and uses the same collection page, search, section controls, and table as Spaces. Transfers occupies the full content pane without the folder sidebar, preview panel, or their bottom-bar toggles. History is searched and filtered before pagination; active operations refresh while the page is visible. The page supports native pause, resume, cancel, retry, undo, and the existing file-conflict dialog where available. Local copies report bytes and speed, including nested directories and moves across volumes. Pausing a local copy cancels its partial destination; resuming restarts that file. Pausing the queue only stops new operations from starting.

Files supports local disks, OS-mounted network shares (such as SMB/NFS), and paired devices reached directly over the LAN. It has no cloud storage provider setup, OAuth flow, cloud API adapter, rclone process, internet relay, or public peer discovery. Pairing and device permissions still apply to LAN access.

Paired devices connect once through Misty's server (pairing, or Connect after a session ends). That starts a local session in both directions, which lasts the number of days chosen in Settings → File sharing; within it the devices reconnect on their own with session tokens checked on each device, without the server. Each device decides for itself whether a paired device may change its files and whether they share a clipboard. Users who want access beyond the LAN bring their own private network; Misty provides no relay. Retired provider locations are excluded from saved shortcuts and migrated to the local home folder when restored.

From the repository root, run `misty desktop dev` for development or `npm run build:desktop` to build the frontend. Run `misty check tools` for the built-in tool tests.

Shared UI, API adapters, and native services come from this workspace and its root lockfile. See [Built-in Misty tools](https://github.com/misty-org/misty/wiki/Built-in-tools) for the shared build and native-worker lifecycle.
