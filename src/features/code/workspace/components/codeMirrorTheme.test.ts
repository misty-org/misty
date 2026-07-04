import { describe, expect, it } from "vitest";
import {
  editorThemeOptions,
  editorThemeValues,
  resolveEditorPalette,
  resolveEditorTheme,
} from "./codeMirrorTheme";

describe("codeMirrorTheme", () => {
  it("resolves gruvbox dark theme by default", () => {
    const theme = resolveEditorTheme("gruvbox-dark");
    expect(theme).toBeDefined();
    expect(Array.isArray(theme)).toBe(true);
  });

  it("resolves gruvbox light and misty dark themes", () => {
    const lightTheme = resolveEditorTheme("gruvbox-light");
    expect(lightTheme).toBeDefined();

    const mistyTheme = resolveEditorTheme("misty-dark");
    expect(mistyTheme).toBeDefined();
  });

  it("falls back to gruvbox-dark for unknown theme IDs", () => {
    const defaultTheme = resolveEditorTheme("gruvbox-dark");
    const fallbackTheme = resolveEditorTheme("non-existent-theme");
    expect(fallbackTheme).toEqual(defaultTheme);
  });

  it("exports matching theme options and values", () => {
    expect(editorThemeValues).toContain("gruvbox-dark");
    expect(editorThemeValues).toContain("gruvbox-light");
    expect(editorThemeValues).toContain("misty-dark");
    expect(editorThemeOptions.length).toBe(editorThemeValues.length);
  });

  it("exposes matching semantic palettes to the Code workspace", () => {
    expect(resolveEditorPalette("gruvbox-dark").bg).toBe("#282828");
    expect(resolveEditorPalette("gruvbox-light").bg).toBe("#fbf1c7");
    expect(resolveEditorPalette("misty-dark").panelBg).toBe("#161616");
  });
});
