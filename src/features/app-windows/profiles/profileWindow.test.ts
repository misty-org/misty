import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (message: { payload: unknown }) => void) => {
    native.listeners.set(event, handler);
    return () => undefined;
  }),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));

type Opening = { windowId?: string; profile?: unknown; space?: string | null };
const openedAs = (opening?: Opening) => {
  (window as unknown as { __MISTY_WINDOW__?: Opening }).__MISTY_WINDOW__ = opening;
};

describe("a window's native identity", () => {
  beforeEach(() => {
    vi.resetModules();
    native.invoke.mockReset();
    native.listeners.clear();
    openedAs(undefined);
  });

  it("reads who it is before anything renders", async () => {
    openedAs({
      windowId: "w-1",
      profile: { id: "work", name: "Work", order: 2 },
      space: "space_1",
    });
    const window = await import("./profileWindow");
    expect(window.currentWindowId()).toBe("w-1");
    expect(window.currentProfile()).toEqual({ id: "work", name: "Work", order: 2 });
    expect(native.invoke).not.toHaveBeenCalled();
    const space = await import("../tabs/spaceWindow");
    expect(space.spaceWindow()).toMatchObject({ key: "space_1", spaceId: "space_1" });
  });

  it("falls back to the first profile with no native window", async () => {
    const window = await import("./profileWindow");
    expect(window.currentProfile().id).toBe(window.firstProfileId);
    const space = await import("../tabs/spaceWindow");
    expect(space.spaceWindow()).toMatchObject({ key: "personal", personal: true, spaceId: null });
  });

  it("refuses a profile without an id and a name", async () => {
    const { parseProfileEntry } = await import("./profileWindow");
    expect(parseProfileEntry({ id: "a", name: "A" })).toEqual({ id: "a", name: "A", order: 0 });
    expect(parseProfileEntry({ id: 1, name: "A" })).toBeNull();
  });

  it("follows the native identity and the profile's changes", async () => {
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "profile_window_info")
        return {
          label: "window-3",
          windowId: "w-3",
          profile: { id: "work", name: "Work", order: 1 },
          space: null,
        };
      return null;
    });
    const window = await import("./profileWindow");
    window.startProfileWindow();
    await vi.waitFor(() => expect(window.currentWindowId()).toBe("w-3"));
    native.listeners.get("misty://profile-window")?.({
      payload: { id: "work", name: "Renamed", order: 1 },
    });
    expect(window.currentProfile()).toMatchObject({ name: "Renamed" });
    native.listeners.get("misty://profile-window")?.({
      payload: { id: "someone-else", name: "Other", order: 3 },
    });
    expect(window.currentProfile().id).toBe("work");
  });

  it("names every window command as the native side does", async () => {
    native.invoke.mockResolvedValue(null);
    const window = await import("./profileWindow");
    await window.openNewWindow();
    await window.closeWindow();
    expect(native.invoke.mock.calls).toEqual([["profile_window_new"], ["profile_window_close"]]);
  });
});

describe("a window's current Space", () => {
  beforeEach(() => {
    vi.resetModules();
    native.invoke.mockReset();
    native.invoke.mockResolvedValue(null);
    openedAs(undefined);
  });

  it("is the renderer's, and only remembered natively", async () => {
    const { spaceWindow, switchSpaceWindow, onSpaceWindowSwitch } =
      await import("../tabs/spaceWindow");
    const seen = vi.fn();
    onSpaceWindowSwitch(seen);
    switchSpaceWindow("space_work", false);
    expect(spaceWindow()).toMatchObject({ key: "space_work", spaceId: "space_work" });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenLastCalledWith("profile_window_set_space", {
      space: "space_work",
    });
    switchSpaceWindow("space_personal", true);
    expect(spaceWindow()).toMatchObject({ key: "personal", personal: true, spaceId: null });
    expect(native.invoke).toHaveBeenLastCalledWith("profile_window_set_space", { space: null });
  });
});
