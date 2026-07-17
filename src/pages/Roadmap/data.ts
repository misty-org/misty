export type PhaseStatus = "done" | "active" | "planned";

export interface RoadmapPhase {
  label: string;
  status: PhaseStatus;
  items: string[];
}

export const phases: RoadmapPhase[] = [
  {
    label: "Available",
    status: "done",
    items: [
      "Misty desktop for macOS and Windows",
      "Local file browsing, tabs, workspaces, and common file operations",
      "File previews, metadata inspection, and Deep Search",
      "Transfer queue, progress, controls, and history",
      "Google Drive, OneDrive, and Dropbox Remotes",
    ],
  },
  {
    label: "Preview",
    status: "active",
    items: [
      "Automations workflow editor",
      "Mika, Misty’s experimental AI assistant",
    ],
  },
  {
    label: "Coming next",
    status: "active",
    items: [
      "iPhone and Android distribution",
      "Production account and provider authorization hardening",
      "Desktop and mobile release packaging",
    ],
  },
  {
    label: "Planned",
    status: "planned",
    items: [
      "S3-compatible storage and SFTP Remotes",
      "Backups, snapshots, and restore workflows",
      "Verified Linux distribution",
      "Shared workspaces and team accounts",
      "Broader offline and sync workflows",
    ],
  },
];
