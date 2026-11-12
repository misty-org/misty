import { beforeEach, describe, expect, it, vi } from "vitest";

const close = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./terminalApi", () => ({ terminalApi: { close } }));

import { terminalTabTitle, useTerminalStore } from "./terminalStore";

const FOLDER = "/work/app";

describe("terminal tabs", () => {
  beforeEach(() => {
    close.mockClear();
    useTerminalStore.setState({ tabsByFolder: {}, activeByFolder: {}, launchTabs: {} });
  });

  it("keeps each folder's tabs apart and selects a new tab", () => {
    const store = useTerminalStore.getState();
    const first = store.newTab(FOLDER);
    const other = store.newTab("/work/other");
    const second = store.newTab(FOLDER);
    const state = useTerminalStore.getState();
    expect(state.tabsByFolder[FOLDER].map((tab) => tab.id)).toEqual([first, second]);
    expect(state.activeByFolder[FOLDER]).toBe(second);
    expect(state.activeByFolder["/work/other"]).toBe(other);
  });

  it("ends a closed tab's shell and selects the tab that took its place", () => {
    const store = useTerminalStore.getState();
    const a = store.newTab(FOLDER);
    const b = store.newTab(FOLDER);
    const c = store.newTab(FOLDER);
    store.selectTab(FOLDER, b);
    store.closeTab(FOLDER, b);
    expect(close).toHaveBeenCalledWith(b);
    expect(useTerminalStore.getState().activeByFolder[FOLDER]).toBe(c);
    store.closeTab(FOLDER, c);
    expect(useTerminalStore.getState().activeByFolder[FOLDER]).toBe(a);
  });

  it("reuses the same tab for a key until it is closed", () => {
    const store = useTerminalStore.getState();
    const launch = store.ensureTab(FOLDER, "launch", "npm run dev");
    store.newTab(FOLDER);
    expect(store.ensureTab(FOLDER, "launch", "Dev server")).toBe(launch);
    expect(useTerminalStore.getState().activeByFolder[FOLDER]).toBe(launch);
    expect(useTerminalStore.getState().tabsByFolder[FOLDER][0].title).toBe("Dev server");
    store.closeTab(FOLDER, launch);
    expect(store.ensureTab(FOLDER, "launch", "Dev server")).not.toBe(launch);
  });

  it("names tabs by their own title or their place", () => {
    expect(terminalTabTitle({ id: "a" }, 1)).toBe("Terminal 2");
    expect(terminalTabTitle({ id: "a", title: "Server" }, 1)).toBe("Server");
    const store = useTerminalStore.getState();
    const id = store.newTab(FOLDER);
    store.renameTab(FOLDER, id, "  ");
    expect(useTerminalStore.getState().tabsByFolder[FOLDER][0].title).toBeUndefined();
  });
});
