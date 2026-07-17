export interface ChangelogGroup {
  heading: string;
  changes: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  status: "in-development" | "released";
  groups: ChangelogGroup[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: "v0.1.0",
    date: "In development",
    summary: "First public release",
    status: "in-development",
    groups: [
      {
        heading: "Desktop foundation",
        changes: [
          "React and Tauri desktop application for macOS and Windows",
          "Local-first services that keep file operations on your device",
          "Tabs, workspaces, pinned locations, and multi-panel file browsing",
        ],
      },
      {
        heading: "Files and Search",
        changes: [
          "Create, rename, copy, move, upload, download, and delete workflows",
          "File previews, metadata inspection, tags, sorting, and view controls",
          "Deep Search across indexed local and connected locations",
        ],
      },
      {
        heading: "Remotes and Transfers",
        changes: [
          "Google Drive, OneDrive, and Dropbox Remote connections",
          "Persistent transfer history with progress, filters, retry, pause, resume, and cancel controls where supported",
        ],
      },
      {
        heading: "Experimental Automations and Mika",
        changes: [
          "Desktop workflow editor with manual, interval, and local webhook triggers",
          "Experimental Mika assistant for contextual file discovery and reviewed actions",
        ],
      },
      {
        heading: "Mobile preparation",
        changes: [
          "iPhone and Android Files, Remotes, Transfers, Account, and Settings experiences in release preparation",
          "Public mobile store downloads are coming soon",
        ],
      },
    ],
  },
];
