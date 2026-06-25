import { describe, expect, it } from "vitest";
import { contrastRatio } from "./ThemesPlugin";

describe("theme contrast", () => {
  it("matches WCAG contrast reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });
});
