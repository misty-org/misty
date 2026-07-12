export type PlatformName = "Windows" | "macOS" | "Linux";
export type MobilePlatformName = "iPhone" | "Android";

export type ReleaseBuild = {
  platform: PlatformName;
  tag: string;
  platformKey: "windows" | "macos" | "linux";
};

export type MobileBuild = {
  platform: MobilePlatformName;
  tag: string;
  availability: string;
  description: string;
  ctaLabel: string;
  href?: string;
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
    date: "Current",
    builds: [
      { platform: "Windows", tag: "Installer", platformKey: "windows" },
      { platform: "macOS", tag: "DMG", platformKey: "macos" },
    ],
    notes: [
      "Desktop build for early customers",
      "Core file browsing, search, and transfer workflows",
      "Google Drive, OneDrive, and Dropbox Remote connections",
      "Rough edges expected; join Discord to report bugs and follow fixes",
    ],
  },
];

export const mobileBuilds: MobileBuild[] = [
  {
    platform: "iPhone",
    tag: "iOS",
    availability: "Coming soon",
    description: "Misty for iPhone brings file browsing, connected providers, transfers, account controls, and settings into a mobile interface.",
    ctaLabel: "App Store Soon",
  },
  {
    platform: "Android",
    tag: "Android",
    availability: "Coming soon",
    description: "The Android build shares Misty’s mobile Files, Remotes, Transfers, Account, and Settings experience and is in release preparation.",
    ctaLabel: "Android Soon",
  },
];
