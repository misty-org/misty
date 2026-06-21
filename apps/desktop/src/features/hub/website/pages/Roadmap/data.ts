export type PhaseStatus = "done" | "active" | "planned";

export interface RoadmapPhase {
  label: string;
  status: PhaseStatus;
  items: string[];
}

export const phases: RoadmapPhase[] = [
  {
    label: "Shipped",
    status: "done",
    items: [
      "Google Drive & OneDrive integration",
      "Unified file browser",
      "Multi-account support",
      "Misty clipboard",
      "Linux support",
    ],
  },
  {
    label: "In Progress",
    status: "active",
    items: [
      "Dropbox & Box integration",
      "Encrypted transfers",
      "File preview panel",
      "Keyboard shortcut customization",
    ],
  },
  {
    label: "Planned",
    status: "planned",
    items: [
      "S3-compatible storage support",
      "Shared workspaces & team accounts",
      "Mobile companion app",
      "Plugin / extension system",
      "Offline mode with sync queue",
    ],
  },
];
