import { describe, expect, it } from "vitest";
import { pathData } from "./BrowserAnnotationLayer";
import { browserViewportWidths } from "./BrowserViewportMenu";

describe("browser annotation paths", () => {
  it("creates an SVG path through each captured point", () => {
    expect(
      pathData([
        { x: 10, y: 20 },
        { x: 12, y: 24 },
        { x: 18, y: 30 },
      ]),
    ).toBe("M10,20 L12,24 L18,30");
  });

  it("keeps an empty gesture empty", () => {
    expect(pathData([])).toBe("");
  });
});

describe("browser viewport presets", () => {
  it("uses practical responsive design widths", () => {
    expect(browserViewportWidths).toEqual({
      responsive: null,
      desktop: 1280,
      tablet: 820,
      mobile: 390,
    });
  });
});
