import { describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { setWindowColor } from "./windows";
import { nextWindowColor, windowChromeBackground, windowColorNames } from "./windowColors";

describe("window colors", () => {
  it("offers an unused color first, then the least used", () => {
    expect(nextWindowColor([])).toBe(windowColorNames[0]);
    expect(nextWindowColor([windowColorNames[0]])).toBe(windowColorNames[1]);
    expect(nextWindowColor([...windowColorNames, windowColorNames[0]])).toBe(windowColorNames[1]);
  });

  it("tints only a colored window's chrome", () => {
    expect(windowChromeBackground(undefined)).toBeUndefined();
    expect(windowChromeBackground("blue")).toContain("color-mix");
  });

  it("gives a new window the chosen color, or an unused one, and recolors it", () => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
    const chosen = useWorkspaceStore.getState().createWindow(undefined, "pink");
    expect(chosen.color).toBe("pink");
    const automatic = useWorkspaceStore.getState().createWindow();
    expect(automatic.color).toBeDefined();
    useWorkspaceStore.setState(setWindowColor(useWorkspaceStore.getState(), chosen.id, "cyan"));
    const windows = useWorkspaceStore.getState().windowsByScope.global ?? [];
    expect(windows.find((item) => item.id === chosen.id)?.color).toBe("cyan");
  });
});
