import { beforeEach, describe, expect, it } from "vitest";
import { applyStoredExtensionTheme, extensionThemeSnapshot } from "./extensionTheme";

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
});
