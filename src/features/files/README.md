# Files

This directory contains Misty's built-in file browser, previews, file operations, including colocated tests. Its component entry and workspace code compile into Misty; they have no separate installation or update lifecycle.

Each Files tab shows one file pane, with optional navigation and preview sidebars.

Files supports local disks, OS-mounted network shares (such as SMB/NFS), and paired devices reached directly over the LAN. It has no cloud storage provider setup, OAuth flow, cloud API adapter, rclone process, internet relay, or public peer discovery. Pairing and device permissions still apply to LAN access. Retired provider locations are excluded from saved shortcuts and migrated to the local home folder when restored.

From the repository root, run `misty desktop dev` for development or `npm run build:desktop` to build the frontend. Run `misty check tools` for the built-in tool tests.

Shared UI, API adapters, and native services come from this workspace and its root lockfile. See [Built-in Misty tools](https://github.com/misty-org/misty/wiki/Built-in-tools) for the shared build and native-worker lifecycle.
