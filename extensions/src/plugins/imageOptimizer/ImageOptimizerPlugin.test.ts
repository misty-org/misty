import { describe, expect, it } from "vitest";
import { supportedImagePath } from "./ImageOptimizerPlugin";

describe("Image Optimizer selection", () => {
  it("accepts only the supported image formats without case sensitivity", () => {
    expect(["a.JPG", "b.jpeg", "c.png", "d.WebP"].every(supportedImagePath)).toBe(true);
    expect(["movie.mp4", "vector.svg", "photo.avif"].some(supportedImagePath)).toBe(false);
  });
});
