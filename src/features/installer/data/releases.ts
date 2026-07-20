import type { ReleaseVersion } from "@/models/types/features/installer/types";

function githubReleaseUrl(version: string) {
  return `https://github.com/misty-org/misty-public/releases/tag/${version}`;
}

export const releases: ReleaseVersion[] = [
  {
    version: "v0.1.0",
    date: "GitHub releases",
    summary: "Misty release",
    manifestUrl: githubReleaseUrl("v0.1.0"),
    changes: [
      "Release metadata is read from github.com/misty-org/misty-public.",
      "Install files are resolved from the Misty template plan.",
    ],
  },
];
