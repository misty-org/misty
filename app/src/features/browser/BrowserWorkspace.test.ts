import { describe, expect, it } from "vitest";

import { browserBoundsAtAppZoom, normalizeBrowserAddress } from "./BrowserWorkspace";

describe("browser address normalization", () => {
  it("preserves explicit web URLs", () => {
    expect(normalizeBrowserAddress("https://example.com/path?q=misty")).toBe(
      "https://example.com/path?q=misty",
    );
  });

  it("adds HTTPS to hostnames", () => {
    expect(normalizeBrowserAddress("example.com/docs")).toBe("https://example.com/docs");
  });

  it("turns free text into a search", () => {
    expect(normalizeBrowserAddress("human agent workspace")).toBe(
      "https://www.google.com/search?q=human%20agent%20workspace",
    );
  });

  it("keeps an empty omnibox on the native blank page", () => {
    expect(normalizeBrowserAddress("   ")).toBe("about:blank");
  });
});

describe("native browser bounds", () => {
  it("converts zoomed CSS pixels into window coordinates", () => {
    expect(browserBoundsAtAppZoom({ x: 72, y: 110, width: 900, height: 600 }, 1.25)).toEqual({
      x: 90,
      y: 137.5,
      width: 1125,
      height: 750,
    });
  });

  it("falls back safely when the app zoom is invalid", () => {
    const bounds = { x: 72, y: 110, width: 900, height: 600 };
    expect(browserBoundsAtAppZoom(bounds, Number.NaN)).toEqual(bounds);
  });
});
