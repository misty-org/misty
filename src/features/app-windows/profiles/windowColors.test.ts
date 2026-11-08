import { describe, expect, it } from "vitest";
import { windowChromeBackground } from "./windowColors";
import { useProfileWindowStore } from "./profileWindow";
import { currentWindow, initialWorkspaceWindow } from "./windows";

describe("profile colors", () => {
  it("tints only a colored profile's window chrome", () => {
    expect(windowChromeBackground(undefined)).toBeUndefined();
    expect(windowChromeBackground("blue")).toContain("color-mix");
  });

  it("gives the window its profile's color and name", () => {
    const before = useProfileWindowStore.getState().profile;
    useProfileWindowStore.setState({
      profile: { id: "work", name: "Work", color: "pink", order: 1, sites: [] },
    });
    const window = currentWindow(initialWorkspaceWindow());
    expect(window.color).toBe("pink");
    expect(window.title).toBe("Work");
    useProfileWindowStore.setState({ profile: before });
  });
});
