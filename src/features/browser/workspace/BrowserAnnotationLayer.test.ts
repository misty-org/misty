import { describe, expect, it } from "vitest";
import { pathData } from "./BrowserAnnotationLayer";
import { browserViewportDefaults, browserViewportFrameStyle } from "./BrowserViewportMenu";

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
  it("uses practical device sizes with a 1080p desktop", () => {
    expect(browserViewportDefaults).toEqual({
      desktop: { width: 1920, height: 1080 },
      tablet: { width: 820, height: 1180 },
      mobile: { width: 390, height: 844 },
    });
  });

  it("fits device sizes to the pane while keeping their aspect ratio", () => {
    expect(browserViewportFrameStyle(null)).toEqual({ width: "100%", height: "100%" });
    expect(browserViewportFrameStyle({ width: 1920, height: 1080 })).toEqual({
      width: "min(100cqw, 1920px, calc(100cqh * 1920 / 1080))",
      height: "min(100cqh, 1080px, calc(100cqw * 1080 / 1920))",
    });
  });
});
