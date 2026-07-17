export type PlatformName = "Windows" | "macOS" | "Linux";
export type MobilePlatformName = "iOS" | "Android";

export type ReleaseBuild = {
  platform: PlatformName;
  tag: string;
  platformKey: "windows" | "macos" | "linux";
};

export type MobileBuild = {
  platform: MobilePlatformName;
  tag: string;
  ctaLabel: string;
  href?: string;
};

export interface Release {
  version: string;
  date: string;
  builds: ReleaseBuild[];
}

export const releases: Release[] = [
  {
    version: "v0.1.0",
    date: "Current",
    builds: [
      { platform: "Windows", tag: "Installer", platformKey: "windows" },
      { platform: "macOS", tag: "DMG", platformKey: "macos" },
      { platform: "Linux", tag: "AppImage", platformKey: "linux" },
    ],
  },
];

export const mobileBuilds: MobileBuild[] = [
  {
    platform: "iOS",
    tag: "iOS",
    ctaLabel: "Coming soon",
  },
  {
    platform: "Android",
    tag: "Android",
    ctaLabel: "Coming soon",
  },
];
