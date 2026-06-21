export type PlatformName = "Windows" | "macOS" | "Linux";

export type ReleaseBuild = {
  platform: PlatformName;
  tag: string;
  platformKey: "windows" | "macos" | "linux";
};

export interface Release {
  version: string;
  date: string;
  builds: ReleaseBuild[];
  notes: string[];
}

export const releases: Release[] = [
  {
    version: "v0.1.0",
    date: "December 2025",
    builds: [
      { platform: "Windows", tag: "Installer", platformKey: "windows" },
      { platform: "macOS", tag: "DMG", platformKey: "macos" },
      { platform: "Linux", tag: "AppImage", platformKey: "linux" },
    ],
    notes: [
      "Initial release with Windows, macOS, and Linux support",
      "Google Drive, OneDrive, and iCloud integration",
      "Unified file browser with search",
      "Secure local-only proxy architecture",
    ],
  },
];
