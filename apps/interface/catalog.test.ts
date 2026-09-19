import { describe, expect, it } from "vitest";

import {
  extensionIdFromSlug,
  extensionPlatformFamilies,
  extensionSlug,
  filterExtensionCatalog,
  type ExtensionPresentation,
} from "./catalog";

const entries: ExtensionPresentation[] = [
  {
    id: "quick_convert",
    name: "Quick Convert",
    version: "0.3.0",
    overview: "Convert local media files.",
    capabilities: ["Image and audio conversion"],
    whereItAppears: ["Files"],
    permissions: ["Read selected files"],
    gettingStarted: ["Select a file."],
    includedTools: [{ name: "FFmpeg", version: "7.1.1" }],
    links: [],
    verified: true,
    platforms: ["macos-aarch64", "windows-x86_64", "linux-x86_64"],
  },
];

describe("extension interface", () => {
  it("uses stable public slugs", () => {
    expect(extensionSlug("quick_convert")).toBe("quick-convert");
    expect(extensionIdFromSlug("quick-convert")).toBe("quick_convert");
  });

  it("maps artifacts to platform families", () => {
    expect(extensionPlatformFamilies(entries[0])).toEqual([
      "macOS",
      "Windows",
      "Linux",
    ]);
  });

  it("searches included tool names", () => {
    expect(filterExtensionCatalog(entries, "ffmpeg")).toEqual(entries);
    expect(filterExtensionCatalog(entries, "backup")).toEqual([]);
  });
});
