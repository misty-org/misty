import { useSettingsStore } from "@/features/settings/store/useSettingsStore";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchShortcutEvent, invokeShortcutCommand, registerShortcutHandler } from "./runtime";
import { detectShortcutPlatform } from "./bindings";

describe("shortcut dispatcher", () => {
  beforeEach(() => {
    useSettingsStore.setState({ shortcuts: null });
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("does not dispatch workspace shortcuts underneath the sleeping device overlay", () => {
    const overlay = document.createElement("div");
    overlay.dataset.deviceSyncSleep = "";
    document.body.appendChild(overlay);
    const handler = vi.fn();
    const remove = registerShortcutHandler("search.toggle", handler);
    expect(
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true }),
      ),
    ).toBe(false);
    expect(invokeShortcutCommand("search.toggle")).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    remove();
    overlay.remove();
  });

  it("runs a tool's shortcut only while that tool is focused", () => {
    useWorkspaceStore.getState().openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Agents",
      route: "/agents",
      instancePolicy: "single",
    });
    const browserHandler = vi.fn();
    const remove = registerShortcutHandler("browser.edit_address", browserHandler);
    const editAddress = () =>
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", { key: "l", code: "KeyL", ctrlKey: true }),
      );
    editAddress();
    expect(browserHandler).not.toHaveBeenCalled();
    useWorkspaceStore.getState().openBrowserView({ url: "https://example.com" });
    editAddress();
    expect(browserHandler).toHaveBeenCalledOnce();
    remove();
  });

  it("uses explicit handler priority and falls through when a handler declines", () => {
    const calls: string[] = [];
    const removeFallback = registerShortcutHandler("search.toggle", () => {
      calls.push("fallback");
      return true;
    });
    const removeFocused = registerShortcutHandler(
      "search.toggle",
      () => {
        calls.push("focused");
        return false;
      },
      () => true,
      100,
    );

    expect(
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", { key: "t", code: "KeyT", ctrlKey: true }),
      ),
    ).toBe(true);
    expect(calls).toEqual(["focused", "fallback"]);
    removeFocused();
    removeFallback();
  });

  it("protects typing targets unless a command opts in", () => {
    useWorkspaceStore.getState().openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Files",
      route: "/agents",
      instancePolicy: "single",
    });
    const handler = vi.fn();
    const remove = registerShortcutHandler("explorer.copy", handler);
    const event = new KeyboardEvent("keydown", { key: "c", code: "KeyC", ctrlKey: true });
    Object.defineProperty(event, "target", { value: document.createElement("input") });
    expect(dispatchShortcutEvent(event)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    remove();
  });

  it("opens global browser search from Agent chat", () => {
    const agentChat = document.createElement("main");
    agentChat.dataset.mistyAgentChat = "";
    const textarea = document.createElement("textarea");
    agentChat.appendChild(textarea);
    document.body.appendChild(agentChat);
    textarea.focus();
    const handler = vi.fn();
    const remove = registerShortcutHandler("search.toggle", handler);
    const event = new KeyboardEvent("keydown", {
      key: "t",
      code: "KeyT",
      ctrlKey: true,
    });
    Object.defineProperty(event, "target", { value: textarea });

    expect(dispatchShortcutEvent(event)).toBe(true);
    expect(invokeShortcutCommand("search.toggle")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);

    remove();
    agentChat.remove();
  });

  it("ignores repeat events for non-repeatable commands", () => {
    const handler = vi.fn();
    const remove = registerShortcutHandler("search.toggle", handler);
    expect(
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", {
          key: "t",
          code: "KeyT",
          ctrlKey: true,
          repeat: true,
        }),
      ),
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    remove();
  });

  it("dispatches Ctrl+Minus to app zoom out", () => {
    const handler = vi.fn();
    const remove = registerShortcutHandler("app.zoom_out", handler);

    expect(
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", {
          key: "-",
          code: "Minus",
          ctrlKey: true,
        }),
      ),
    ).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    remove();
  });

  it("dispatches Cmd+Minus to app zoom out on macOS", () => {
    useSettingsStore.setState({
      shortcuts: {
        detectedPlatform: "macos",
        profileName: "Default",
        commandDefinitions: [],
        effectiveBindings: [],
        bindings: [],
        configPath: "",
        overrides: [],
      },
    });
    const handler = vi.fn();
    const remove = registerShortcutHandler("app.zoom_out", handler);

    expect(
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", {
          key: "-",
          code: "Minus",
          metaKey: true,
        }),
      ),
    ).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    remove();
  });

  it("switches Space sections with a number while a Space page is focused, tabs elsewhere", () => {
    const store = useWorkspaceStore.getState();
    store.openSurface({
      surfaceId: "space",
      groupKey: "space:alpha:notes",
      title: "Notes",
      route: "/spaces/alpha/notes",
      instancePolicy: "multiple",
    });
    const sectionHandler = vi.fn();
    const tabHandler = vi.fn();
    const removeSection = registerShortcutHandler("space.section_2", sectionHandler);
    const removeTab = registerShortcutHandler("workspace.tab_2", tabHandler);
    const two = () => new KeyboardEvent("keydown", { key: "2", code: "Digit2", ctrlKey: true });

    expect(dispatchShortcutEvent(two())).toBe(true);
    expect(sectionHandler).toHaveBeenCalledOnce();
    expect(tabHandler).not.toHaveBeenCalled();

    store.openSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browser",
      route: "/browser",
      instancePolicy: "multiple",
    });
    expect(dispatchShortcutEvent(two())).toBe(true);
    expect(tabHandler).toHaveBeenCalledOnce();

    removeSection();
    removeTab();
  });

  it("opens a new tab with Cmd+T only; Cmd+K is not bound", () => {
    const handler = vi.fn();
    const remove = registerShortcutHandler("search.toggle", handler);
    // Primary: Cmd+T / Ctrl+T
    const primaryEvent = new KeyboardEvent("keydown", {
      key: "t",
      code: "KeyT",
      ctrlKey: true,
      metaKey: false,
    });
    expect(dispatchShortcutEvent(primaryEvent)).toBe(true);

    const retired = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      metaKey: false,
    });
    expect(dispatchShortcutEvent(retired)).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    remove();
  });

  it("handles forwarded browser-scoped shortcut events when browser surface is active", () => {
    const store = useWorkspaceStore.getState();
    const browserTab = store.openSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browser",
      route: "/browser",
      instancePolicy: "multiple",
    });
    store.focusView(browserTab.id);
    const editAddressHandler = vi.fn();
    const remove = registerShortcutHandler("browser.edit_address", editAddressHandler);

    const platform = detectShortcutPlatform();
    const event = new KeyboardEvent("keydown", {
      key: "l",
      code: "KeyL",
      metaKey: platform === "macos",
      ctrlKey: platform !== "macos",
    });
    // Simulating forwarded event from embedded browser with editable=false
    expect(dispatchShortcutEvent(event, false)).toBe(true);
    expect(editAddressHandler).toHaveBeenCalledOnce();

    remove();
    store.closeView(browserTab.id);
  });
});
