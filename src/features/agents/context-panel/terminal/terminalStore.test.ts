import { beforeEach, describe, expect, it, vi } from "vitest";

const close = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./terminalApi", () => ({ terminalApi: { close } }));

import { terminalChatKey, terminalTabTitle, useTerminalStore } from "./terminalStore";

const FOLDER = "/work/app";
const CHAT = "chat-1";

describe("terminal tabs", () => {
  beforeEach(() => {
    close.mockClear();
    useTerminalStore.setState({ tabsByChat: {}, activeByChat: {}, launchTabs: {} });
  });

  it("keeps each chat's tabs apart, even in one folder, and selects a new tab", () => {
    const store = useTerminalStore.getState();
    const first = store.newTab(CHAT, FOLDER);
    const other = store.newTab("chat-2", FOLDER);
    const second = store.newTab(CHAT, "/work/other");
    const state = useTerminalStore.getState();
    expect(state.tabsByChat[CHAT].map((tab) => [tab.id, tab.folder])).toEqual([
      [first, FOLDER],
      [second, "/work/other"],
    ]);
    expect(state.activeByChat[CHAT]).toBe(second);
    expect(state.activeByChat["chat-2"]).toBe(other);
  });

  it("ends a closed tab's shell and selects the tab that took its place", () => {
    const store = useTerminalStore.getState();
    const a = store.newTab(CHAT, FOLDER);
    const b = store.newTab(CHAT, FOLDER);
    const c = store.newTab(CHAT, FOLDER);
    store.selectTab(CHAT, b);
    store.closeTab(CHAT, b);
    expect(close).toHaveBeenCalledWith(b);
    expect(useTerminalStore.getState().activeByChat[CHAT]).toBe(c);
    store.closeTab(CHAT, c);
    expect(useTerminalStore.getState().activeByChat[CHAT]).toBe(a);
  });

  it("reuses the same tab for a key until it is closed", () => {
    const store = useTerminalStore.getState();
    const launch = store.ensureTab(CHAT, FOLDER, "launch", "npm run dev");
    store.newTab(CHAT, FOLDER);
    expect(store.ensureTab(CHAT, FOLDER, "launch", "Dev server")).toBe(launch);
    expect(useTerminalStore.getState().activeByChat[CHAT]).toBe(launch);
    expect(useTerminalStore.getState().tabsByChat[CHAT][0].title).toBe("Dev server");
    expect(store.ensureTab("chat-2", FOLDER, "launch", "Dev server")).not.toBe(launch);
    store.closeTab(CHAT, launch);
    expect(store.ensureTab(CHAT, FOLDER, "launch", "Dev server")).not.toBe(launch);
  });

  it("hands a new chat's tabs to it once it is sent", () => {
    const draft = terminalChatKey("", "view-1");
    expect(draft).not.toBe(terminalChatKey("", "view-2"));
    const store = useTerminalStore.getState();
    const launch = store.ensureTab(draft, FOLDER, "launch", "Dev");
    store.moveChat(draft, CHAT);
    const state = useTerminalStore.getState();
    expect(state.tabsByChat[draft]).toBeUndefined();
    expect(state.tabsByChat[CHAT].map((tab) => tab.id)).toEqual([launch]);
    expect(state.activeByChat[CHAT]).toBe(launch);
    expect(store.ensureTab(CHAT, FOLDER, "launch", "Dev")).toBe(launch);
  });

  it("ends every shell of a chat that closes", () => {
    const store = useTerminalStore.getState();
    const a = store.newTab(CHAT, FOLDER);
    const b = store.newTab(CHAT, FOLDER);
    store.closeChat(CHAT);
    expect(close).toHaveBeenCalledWith(a);
    expect(close).toHaveBeenCalledWith(b);
    expect(useTerminalStore.getState().tabsByChat[CHAT]).toBeUndefined();
  });

  it("names tabs by their own title or their place", () => {
    expect(terminalTabTitle({}, 1)).toBe("Terminal 2");
    expect(terminalTabTitle({ title: "Server" }, 1)).toBe("Server");
    const store = useTerminalStore.getState();
    const id = store.newTab(CHAT, FOLDER);
    store.renameTab(CHAT, id, "  ");
    expect(useTerminalStore.getState().tabsByChat[CHAT][0].title).toBeUndefined();
  });
});
