import { expect, it } from "vitest";
import { siteIconTone } from "./siteIconLoader";

/** RGBA pixels: `count` of each color given. */
function pixels(...runs: [count: number, r: number, g: number, b: number, a?: number][]) {
  return runs.flatMap(([count, r, g, b, a = 255]) =>
    Array.from({ length: count }, () => [r, g, b, a]).flat(),
  );
}

it("calls an icon dark or light only when nearly all of it is", () => {
  expect(siteIconTone(pixels([100, 0, 0, 0]))).toBe("dark");
  expect(siteIconTone(pixels([100, 20, 20, 24]))).toBe("dark");
  expect(siteIconTone(pixels([100, 255, 255, 255]))).toBe("light");
  // A black tile with a white mark shows on any surface, as does a colored icon.
  expect(siteIconTone(pixels([80, 0, 0, 0], [20, 255, 255, 255]))).toBe("mixed");
  expect(siteIconTone(pixels([100, 29, 155, 240]))).toBe("mixed");
});

it("ignores transparent pixels", () => {
  // A black glyph on a transparent ground is what vanishes on a dark sidebar.
  expect(siteIconTone(pixels([900, 255, 255, 255, 0], [100, 0, 0, 0]))).toBe("dark");
  expect(siteIconTone(pixels([900, 0, 0, 0, 0], [100, 255, 255, 255]))).toBe("light");
  expect(siteIconTone(pixels([100, 0, 0, 0, 0]))).toBe("mixed");
  expect(siteIconTone([])).toBe("mixed");
});
