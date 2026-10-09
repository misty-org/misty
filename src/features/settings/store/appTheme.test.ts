import { afterEach, describe, expect, it, vi } from "vitest";
import { appThemeChangedEvent, appThemeSnapshot, applyAppTheme } from "./appTheme";

describe("app theme", () => {
  afterEach(() => {
    applyAppTheme("dark");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("exposes the Misty palette as a complete semantic theme", () => {
    const snapshot = applyAppTheme("dark");
    expect(snapshot.themeId).toBe("misty-dark");
    expect(snapshot.mode).toBe("dark");
    expect(snapshot.tokens.background).toBe("#131313");
    expect(snapshot.tokens.border).toMatch(/^#[0-9A-F]{6}$/);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("switches to the light palette and tells native chrome once", () => {
    const changed = vi.fn();
    window.addEventListener(appThemeChangedEvent, changed);
    applyAppTheme("light");
    applyAppTheme("light");
    window.removeEventListener(appThemeChangedEvent, changed);
    expect(appThemeSnapshot().mode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("follows the system appearance when asked", () => {
    // The test DOM has no matchMedia; stand in a system set to light.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true }) as MediaQueryList),
    );
    expect(applyAppTheme("system").mode).toBe("light");
  });
});
