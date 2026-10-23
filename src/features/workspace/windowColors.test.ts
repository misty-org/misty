import { describe, expect, it } from "vitest";
import { windowChromeBackground } from "./windowColors";
import { useSpaceWindowStore } from "./spaceWindow";
import { currentWindow, initialWorkspaceWindow } from "./windows";

describe("Space colors", () => {
  it("tints only a colored Space's window chrome", () => {
    expect(windowChromeBackground(undefined)).toBeUndefined();
    expect(windowChromeBackground("blue")).toContain("color-mix");
  });

  it("gives the window its Space's color and name", () => {
    useSpaceWindowStore.setState({ space: { key: "personal", name: "Personal", color: "pink" } });
    const window = currentWindow(initialWorkspaceWindow());
    expect(window.color).toBe("pink");
    expect(window.title).toBe("Personal");
    useSpaceWindowStore.setState({ space: null });
  });
});
