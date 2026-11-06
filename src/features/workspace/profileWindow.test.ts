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
      profile: { id: "work", name: "Work", color: "pink", order: 2, sites: ["a.test"] },
      space: "space_1",
    });
    const window = await import("./profileWindow");
    expect(window.currentWindowId()).toBe("w-1");
    expect(window.currentProfile()).toEqual({
      id: "work",
      name: "Work",
      color: "pink",
      order: 2,
      sites: ["a.test"],
    });
    expect(native.invoke).not.toHaveBeenCalled();
    const space = await import("./spaceWindow");
    expect(space.spaceWindow()).toMatchObject({ key: "space_1", spaceId: "space_1" });
  });

  it("falls back to the first profile with no native window", async () => {
    const window = await import("./profileWindow");
    expect(window.currentProfile().id).toBe(window.firstProfileId);
    const space = await import("./spaceWindow");
    expect(space.spaceWindow()).toMatchObject({ key: "personal", personal: true, spaceId: null });
  });

  it("drops a color that isn't one of the profile colors", async () => {
    const { parseProfileEntry } = await import("./profileWindow");
    expect(parseProfileEntry({ id: "a", name: "A", color: "javascript:1" })?.color).toBeUndefined();
    expect(parseProfileEntry({ id: 1, name: "A" })).toBeNull();
  });

  it("follows the native identity and the profile's changes", async () => {
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "profile_window_info")
        return {
          label: "window-3",
          windowId: "w-3",
          profile: { id: "work", name: "Work", order: 1 },
          incognito: false,
          space: null,
        };
      if (command === "profiles_list")
        return [
          { id: "work", name: "Work", order: 1 },
          { id: "personal", name: "Personal", order: 0 },
        ];
      return null;
    });
    const window = await import("./profileWindow");
    window.startProfileWindow();
    await vi.waitFor(() => expect(window.currentWindowId()).toBe("w-3"));
    await vi.waitFor(() =>
      expect(window.useProfileWindowStore.getState().profiles.map((item) => item.id)).toEqual([
        "personal",
        "work",
      ]),
    );
    native.listeners.get("misty://profile-window")?.({
      payload: { id: "work", name: "Renamed", color: "blue", order: 1 },
    });
    expect(window.currentProfile()).toMatchObject({ name: "Renamed", color: "blue" });
    native.listeners.get("misty://profile-window")?.({
      payload: { id: "someone-else", name: "Other", order: 3 },
    });
    expect(window.currentProfile().id).toBe("work");
  });

  it("names every window and profile command as the native side does", async () => {
    native.invoke.mockResolvedValue({ id: "new", name: "New", order: 1 });
    const window = await import("./profileWindow");
    await window.openNewWindow();
    await window.openIncognitoWindow();
    await window.closeWindow();
    await window.openProfile("work");
    await window.createProfile("New", "blue");
    await window.renameProfile("new", "Newer");
    await window.setProfileColor("new", "red");
    await window.deleteProfile("new");
    expect(native.invoke.mock.calls).toEqual([
      ["profile_window_new"],
      ["profile_incognito_open"],
      ["profile_window_close"],
      ["profile_open", { id: "work" }],
      ["profile_create", { name: "New", color: "blue" }],
      ["profile_rename", { id: "new", name: "Newer" }],
      ["profile_set_color", { id: "new", color: "red" }],
      ["profile_delete", { id: "new" }],
    ]);
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
    const { spaceWindow, switchSpaceWindow, onSpaceWindowSwitch } = await import("./spaceWindow");
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
