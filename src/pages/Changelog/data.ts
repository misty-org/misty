export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  changes: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: "v0.3.0",
    date: "March 2026",
    summary: "Linux support & drag-and-drop transfers",
    changes: [
      "Linux support for x86_64 and ARM64",
      "New drag-and-drop transfer interface",
      "Improved connection stability for Google Drive and OneDrive",
      "Dark mode refinements and accessibility improvements",
    ],
  },
  {
    version: "v0.2.1",
    date: "February 2026",
    summary: "Stability & progress reporting",
    changes: [
      "Fixed crash when reconnecting expired Oauth sessions",
      "Improved file upload progress reporting",
      "Minor Ui polish and animation fixes",
    ],
  },
  {
    version: "v0.2.0",
    date: "January 2026",
    summary: "Multi-account & clipboard",
    changes: [
      "Multi-account support for all providers",
      "Misty clipboard for cross-provider file operations",
      "Batch rename and bulk actions",
      "Performance improvements for large directories",
    ],
  },
  {
    version: "v0.1.0",
    date: "December 2025",
    summary: "Initial release",
    changes: [
      "ImGui-based desktop client with local file browsing",
      "Go backend proxy with Grpc communication",
      "Basic file operations (copy, move, delete)",
      "Cross-platform builds for Windows and macOS",
    ],
  },
];
