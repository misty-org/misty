export type PlatformName = "macOS" | "Windows";

export type ReleaseBuild = {
  platform: PlatformName;
  architecture: string;
  packageType: "ZIP";
  href: string;
  note: string;
};

export interface Release {
  version: string;
  label: string;
  releasePage: string;
  builds: ReleaseBuild[];
}

export const currentRelease: Release = {
  version: "v0.1.0",
  label: "Public beta build",
  releasePage: "https://github.com/misty-org/misty-public/releases/tag/v0.1.0",
  builds: [
    {
      platform: "macOS",
      architecture: "Apple Silicon",
      packageType: "ZIP",
      href: "https://pub-6656b731eca949d8bf695989e0c862b8.r2.dev/misty-0.1.0-arm64.zip",
      note: "For Macs with Apple silicon.",
    },
    {
      platform: "Windows",
      architecture: "64-bit (x86_64)",
      packageType: "ZIP",
      href: "https://pub-6656b731eca949d8bf695989e0c862b8.r2.dev/misty-v0.1.0-windows-x86_64.zip",
      note: "For 64-bit Windows PCs.",
    },
  ],
};
