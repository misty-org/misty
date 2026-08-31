import { beforeEach, describe, expect, it } from "vitest";
import {
  applyStoredExtensionTheme,
  extensionThemeSnapshot,
  runExtensionThemeCommand,
} from "./extensionTheme";
import { useAppThemeStore } from "./useAppThemeStore";

describe("extension theme bridge", () => {
  beforeEach(() => {
    window.localStorage.clear();
    applyStoredExtensionTheme();
  });

  it("exposes the Misty palette as a complete semantic theme", () => {
    const snapshot = extensionThemeSnapshot();
    expect(snapshot.themeId).toBe("misty-dark");
    expect(snapshot.mode).toBe("dark");
    expect(snapshot.tokens.background).toBe("#131313");
    expect(snapshot.tokens.border).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("previews a light preset across the app and reverts without saving it", () => {
    const result = runExtensionThemeCommand("themes.applyPreset", {
      preset: "misty-light",
      preview: true,
    });

    expect(result.ok).toBe(true);
    expect(document.documentElement.dataset.mistyTheme).toBe("misty-light");
    expect(useAppThemeStore.getState().resolvedTheme).toBe("light");

    runExtensionThemeCommand("themes.revert", {});
    expect(document.documentElement.dataset.mistyTheme).toBe("misty-dark");
    expect(useAppThemeStore.getState().resolvedTheme).toBe("dark");
  });

  it("persists applied edits and restores them after a preview", () => {
    const applied = runExtensionThemeCommand("themes.apply", {
      preset: "custom",
      tokens: {
        background: "#121314",
        surface: "#181A1C",
        text: "#E3E5E7",
        textMuted: "#969BA0",
        accent: "#A0C4D4",
        selection: "#3B4046",
        success: "#A3BFAB",
        warning: "#D6B77F",
        danger: "#D69A91",
      },
    });
    expect(applied.ok).toBe(true);

    runExtensionThemeCommand("themes.applyPreset", { preset: "copper", preview: true });
    runExtensionThemeCommand("themes.revert", {});

    expect(extensionThemeSnapshot().themeId).toBe("custom");
    expect(extensionThemeSnapshot().tokens.background).toBe("#121314");
  });

  it("rejects malformed theme token payloads", () => {
    const result = runExtensionThemeCommand("themes.preview", {
      tokens: { background: "red" },
    });
    expect(result).toMatchObject({ ok: false });
  });
});
