import type { ReleaseVersion } from "../types/setup";

function githubManifestUrl(version: string) {
  const semver = version.replace(/^v/, "");
  return `https://github.com/misty-org/misty-hub/releases/download/${version}/manifest-${semver}.json`;
}

export const releases: ReleaseVersion[] = [
  {
    version: "v0.1.0",
    date: "December 2025",
    summary: "Initial release",
    manifestUrl: githubManifestUrl("v0.1.0"),
    changes: [
      "ImGui-based desktop client with local file browsing",
      "Go backend proxy with gRPC communication",
      "Basic file operations: copy, move, delete",
      "Cross-platform builds for Windows and macOS",
    ],
  },
];
