import { useSettingsStore } from "@/features/settings/store/useSettingsStore";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchShortcutEvent,
  invokeShortcutCommand,
  registerShortcutHandler,
  useShortcutHandler,
  useShortcutTitle,
} from "./runtime";

describe("shortcut dispatcher", () => {
  beforeEach(() => {
    useSettingsStore.setState({ shortcuts: null });
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("prefers the focused tool over broader scopes", () => {
    useWorkspaceStore.getState().openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: "/terminal",
      instancePolicy: "single",
    });
    const globalHandler = vi.fn();
    const terminalHandler = vi.fn();
    const removeGlobal = registerShortcutHandler("search.toggle", globalHandler);
    const removeTerminal = registerShortcutHandler("terminal.clear", terminalHandler);

    expect(
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true }),
      ),
    ).toBe(true);
    expect(terminalHandler).toHaveBeenCalledOnce();
    expect(globalHandler).not.toHaveBeenCalled();
    removeGlobal();
    removeTerminal();
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
        new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true }),
      ),
    ).toBe(true);
    expect(calls).toEqual(["focused", "fallback"]);
    removeFocused();
    removeFallback();
  });

  it("protects typing targets unless a command opts in", () => {
    useWorkspaceStore.getState().openSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
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

  it("does not open Search while typing in Agent chat", () => {
    const agentChat = document.createElement("main");
    agentChat.dataset.mistyAgentChat = "";
    const textarea = document.createElement("textarea");
    agentChat.appendChild(textarea);
    document.body.appendChild(agentChat);
    textarea.focus();
    const handler = vi.fn();
    const remove = registerShortcutHandler("search.toggle", handler);
    const event = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
    });
    Object.defineProperty(event, "target", { value: textarea });

    expect(dispatchShortcutEvent(event)).toBe(false);
    expect(invokeShortcutCommand("search.toggle")).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    remove();
    agentChat.remove();
  });

  it("ignores repeat events for non-repeatable commands", () => {
    const handler = vi.fn();
    const remove = registerShortcutHandler("search.toggle", handler);
    expect(
      dispatchShortcutEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          code: "KeyK",
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

  it("keeps canonical Space task routes in their focused shortcut scopes", () => {
    const store = useWorkspaceStore.getState();
    const planner = store.openSurface({
      surfaceId: "space",
      groupKey: "space:alpha:planner",
      title: "Planner",
      route: "/spaces/alpha/tasks/agenda",
      instancePolicy: "multiple",
    });
    const plannerHandler = vi.fn();
    const removePlanner = registerShortcutHandler("planner.create", plannerHandler);

    expect(dispatchShortcutEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC" }))).toBe(
      true,
    );
    expect(plannerHandler).toHaveBeenCalledOnce();

    store.updateTabRoute(planner.id, "/spaces/alpha/tasks/roadmaps");
    const roadmapHandler = vi.fn();
    const removeRoadmap = registerShortcutHandler("roadmap.create", roadmapHandler);
    expect(dispatchShortcutEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN" }))).toBe(
      true,
    );
    expect(roadmapHandler).toHaveBeenCalledOnce();

    removePlanner();
    removeRoadmap();
  });

  it("does not rerender shortcut consumers when handlers register", () => {
    const { result, rerender } = renderHook(
      ({ label }: { label: string }) => {
        useShortcutHandler("navigation.back", () => undefined);
        return useShortcutTitle(label, "navigation.back");
      },
      { initialProps: { label: "Back" } },
    );

    expect(result.current).toContain("Back");
    rerender({ label: "Previous" });
    expect(result.current).toContain("Previous");
  });
});
