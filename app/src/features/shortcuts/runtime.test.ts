import { useSettingsStore } from "@/features/settings/store/useSettingsStore";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchShortcutEvent,
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
