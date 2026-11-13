// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { afterEach, describe, expect, it } from "vitest";
import {
  applyFontPreferences,
  codeFontStack,
  CUSTOM_CODE_FONT_FAMILY,
  emptyFontPreferences,
  fontErrorMessage,
  isValidFontFamily,
  normalizeFontMode,
  uiFontStack,
} from "./font";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  localStorage.clear();
});

describe("fonts", () => {
  it("accepts family lists and refuses declarations, keywords and variables", () => {
    expect(isValidFontFamily('"Maple Mono", monospace')).toBe(true);
    expect(isValidFontFamily("Inter; color: red")).toBe(false);
    expect(isValidFontFamily("var(--x)")).toBe(false);
    expect(isValidFontFamily("inherit")).toBe(false);
    expect(normalizeFontMode("system")).toBe("");
    expect(normalizeFontMode("  custom ")).toBe("custom");
  });

  it("keeps Misty's stacks after a chosen family", () => {
    expect(uiFontStack("")).toBeNull();
    expect(uiFontStack("Inter")).toMatch(/^Inter, -apple-system/);
    expect(codeFontStack("custom")).toBe(
      `${JSON.stringify(CUSTOM_CODE_FONT_FAMILY)}, ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace`,
    );
  });

  it("sets and clears the root font tokens", () => {
    applyFontPreferences({ ...emptyFontPreferences, fontFamily: "Inter" });
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--font-sans")).toMatch(/^Inter,/);
    expect(style.getPropertyValue("--font-mono")).toBe("");
    applyFontPreferences(emptyFontPreferences);
    expect(style.getPropertyValue("--font-sans")).toBe("");
  });

  it("words the native error codes", () => {
    expect(fontErrorMessage("font.err.too_large")).toMatch(/64 MB/);
    expect(fontErrorMessage(new Error("other"))).toBe("other");
  });
});
