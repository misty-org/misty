export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  changes: string[];
}

export const changelog: ChangelogEntry[] = [
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
