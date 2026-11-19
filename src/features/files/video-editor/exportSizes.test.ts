import { describe, expect, it } from "vitest";
import {
  defaultExportSize,
  exportSizeChoices,
  exportSizeMismatch,
  resolveExportSize,
} from "@opencut/export/sizes";

const frames = (width: number, height: number) =>
  exportSizeChoices({ canvas: { width, height } }).map(
    (choice) => `${choice.size} ${choice.width}x${choice.height}`,
  );

describe("export sizes keep the project's shape", () => {
  it("offers 720p to 4K by the short side, and YouTube for a 16:9 project", () => {
    expect(frames(1920, 1080)).toEqual([
      "720p 1280x720",
      "1080p 1920x1080",
      "1440p 2560x1440",
      "4k 3840x2160",
      "widescreen 1920x1080",
    ]);
    expect(defaultExportSize({ canvas: { width: 1920, height: 1080 } })).toBe("1080p");
  });

  it("offers TikTok, Reels and Shorts only for a 9:16 project, and Square only for 1:1", () => {
    expect(frames(1080, 1920)).toContain("vertical 1080x1920");
    expect(frames(1080, 1920)).toContain("4k 2160x3840");
    expect(frames(1080, 1920).some((frame) => frame.startsWith("square"))).toBe(false);
    expect(frames(1000, 1000)).toEqual([
      "project 1000x1000",
      "720p 720x720",
      "1080p 1080x1080",
      "1440p 1440x1440",
      "4k 2160x2160",
      "square 1080x1080",
    ]);
    expect(defaultExportSize({ canvas: { width: 1000, height: 1000 } })).toBe("project");
  });

  it("keeps an odd shape's frame even-sized, and says why a platform's frame doesn't fit", () => {
    expect(resolveExportSize({ size: "720p", canvas: { width: 2560, height: 1080 } })).toEqual({
      width: 1706,
      height: 720,
    });
    expect(resolveExportSize({ size: "vertical", canvas: { width: 1920, height: 1080 } })).toBe(
      null,
    );
    expect(exportSizeMismatch({ size: "vertical", canvas: { width: 1920, height: 1080 } })).toBe(
      "TikTok, Reels, Shorts is 1080×1920, a different shape from this video's 1920×1080; change its frame first.",
    );
    expect(exportSizeMismatch({ size: "4k", canvas: { width: 1920, height: 1080 } })).toBeNull();
  });
});
