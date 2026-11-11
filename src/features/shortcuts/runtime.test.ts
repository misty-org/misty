import "@/app/featureSeams";
import { useSettingsStore } from "@/features/settings/preferences/useSettingsStore";
import { useWorkspaceStore } from "@/features/app-windows/tabs/useWorkspaceStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchShortcutEvent, invokeShortcutCommand, registerShortcutHandler } from "./runtime";
import { detectShortcutPlatform } from "../../shared/shortcuts/bindings";

describe("shortcut dispatcher", () => {
  beforeEach(() => {
    useSettingsStore.setState({ shortcuts: null });
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("runs a tool's shortcut only while that tool is focused", () => {
    useWorkspaceStore.getState().openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Agents",
      route: "/agents",
      instancePolicy: "single",
    });
    const spaceHandler = vi.fn();
    const remove = registerShortcutHandler("space.section_1", spaceHandler);
    const mac = detectShortcutPlatform() === "macos";
    const openSection = () =>
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", { key: "1", code: "Digit1", ctrlKey: !mac, metaKey: mac }),
      );
    openSection();
    expect(spaceHandler).not.toHaveBeenCalled();
    const space = useWorkspaceStore.getState().addSurface({
      surfaceId: "space",
      groupKey: "space:family:space",
      title: "Home",
      route: "/spaces/family/home",
    });
    useWorkspaceStore.getState().focusView(space.id);
    openSection();
    expect(spaceHandler).toHaveBeenCalledOnce();
    remove();
  });

  it("uses explicit handler priority and falls through when a handler declines", () => {
    const calls: string[] = [];
    const removeFallback = registerShortcutHandler("app.open_settings", () => {
      calls.push("fallback");
      return true;
    });
    const removeFocused = registerShortcutHandler(
      "app.open_settings",
      () => {
        calls.push("focused");
        return false;
      },
      () => true,
      100,
    );

    expect(
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", { key: ",", code: "Comma", ctrlKey: true }),
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

  it("runs a global command typed in Agent chat", () => {
    const agentChat = document.createElement("main");
    agentChat.dataset.mistyAgentChat = "";
    const textarea = document.createElement("textarea");
    agentChat.appendChild(textarea);
    document.body.appendChild(agentChat);
    textarea.focus();
    const handler = vi.fn();
    const remove = registerShortcutHandler("app.open_settings", handler);
    const event = new KeyboardEvent("keydown", {
      key: ",",
      code: "Comma",
      ctrlKey: true,
    });
    Object.defineProperty(event, "target", { value: textarea });

    expect(dispatchShortcutEvent(event)).toBe(true);
    expect(invokeShortcutCommand("app.open_settings")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);

    remove();
    agentChat.remove();
  });

  it("ignores repeat events for non-repeatable commands", () => {
    const handler = vi.fn();
    const remove = registerShortcutHandler("app.open_settings", handler);
    expect(
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", {
          key: ",",
          code: "Comma",
          ctrlKey: true,
          repeat: true,
        }),
      ),
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    remove();
  });

  it("dispatches Ctrl+Shift+Minus to app zoom out", () => {
    const handler = vi.fn();
    const remove = registerShortcutHandler("app.zoom_out", handler);

    expect(
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", {
          key: "_",
          code: "Minus",
          ctrlKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    remove();
  });

  it("dispatches Cmd+Shift+Minus to app zoom out on macOS, and Cmd+Minus never", () => {
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

    dispatchShortcutEvent(new KeyboardEvent("keydown", { key: "-", code: "Minus", metaKey: true }));
    expect(handler).not.toHaveBeenCalled();
    expect(
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", {
          key: "_",
          code: "Minus",
          metaKey: true,
          shiftKey: true,
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
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Agents",
      route: "/agents",
      instancePolicy: "multiple",
    });
    expect(dispatchShortcutEvent(two())).toBe(true);
    expect(tabHandler).toHaveBeenCalledOnce();

    removeSection();
    removeTab();
  });

  it("handles a shortcut forwarded from a page an agent has open", () => {
    const settingsHandler = vi.fn();
    const remove = registerShortcutHandler("app.open_settings", settingsHandler);

    const platform = detectShortcutPlatform();
    const event = new KeyboardEvent("keydown", {
      key: ",",
      code: "Comma",
      metaKey: platform === "macos",
      ctrlKey: platform !== "macos",
    });
    // A page forwards the keys it doesn't take itself, saying whether a field had focus.
    expect(dispatchShortcutEvent(event, false)).toBe(true);
    expect(settingsHandler).toHaveBeenCalledOnce();

    remove();
  });
});
