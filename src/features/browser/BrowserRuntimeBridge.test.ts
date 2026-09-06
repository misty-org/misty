import { afterEach, describe, expect, it, vi } from "vitest";
import { createDockLeaf, dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { initialWorkspaceLayout } from "@/features/workspace/virtualWindows";
import {
  activeBrowserSurfaceExists,
  browserBlockingOverlayOpen,
  focusBrowserRuntimeTab,
} from "./BrowserRuntimeBridge";
import { registerBrowserRuntime } from "./browserRuntime";

describe("browser blocking overlays", () => {
  afterEach(() => document.body.replaceChildren());

  it("recognizes an open workspace dropdown as blocking native browser content", () => {
    const menu = document.createElement("div");
    menu.dataset.slot = "dropdown-menu-content";
    menu.dataset.state = "open";
    document.body.appendChild(menu);

    expect(browserBlockingOverlayOpen()).toBe(true);
  });

  it("restores native browser content once the overlay closes", () => {
    const menu = document.createElement("div");
    menu.dataset.slot = "dropdown-menu-content";
    menu.dataset.state = "closed";
    document.body.appendChild(menu);

    expect(browserBlockingOverlayOpen()).toBe(false);
  });
});

describe("active native Browser ownership", () => {
  it("recognizes the Browser App without treating other Apps as native browser owners", () => {
    const root = createDockLeaf([
      { id: "app-browser", surfaceId: "official-app", groupKey: "app:browser" } as never,
    ]);
    expect(activeBrowserSurfaceExists(root)).toBe(true);
    root.tabs[0].groupKey = "app:inbox";
    expect(activeBrowserSurfaceExists(root)).toBe(false);
  });
  it("releases native Browser content when Inbox is the active surface", () => {
    const root = initialWorkspaceLayout().root;

    expect(activeBrowserSurfaceExists(root)).toBe(false);
  });

  it("keeps native Browser content when any split pane actively owns it", () => {
    const inbox = initialWorkspaceLayout().root;
    if (inbox.type !== "leaf") throw new Error("Expected the initial layout to have one pane");
    const root = createDockLeaf([
      {
        ...inbox.tabs[0],
        id: "browser-tab",
        surfaceId: "browser",
        groupKey: "tool:browser",
        instanceKey: "browser-instance",
        route: "/browser",
      },
    ]);

    expect(activeBrowserSurfaceExists(root)).toBe(true);
  });
});

describe("browser popup tab opening", () => {
  it("opens, focuses, and tracks recent tool usage for popup tabs", () => {
    const store = useWorkspaceStore.getState();
    store.reset();
    const first = store.openBrowserTab({ url: "https://example.com" });
    const second = store.openBrowserTab({
      url: "https://popup.example.com",
      sourceTabId: first.id,
    });

    const focusedPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    expect(focusedPane.activeTabId).toBe(second.id);
    expect(
      focusedPane.tabs
        .filter(
          (tab) =>
            tab.surfaceId === "browser" ||
            (tab.surfaceId === "official-app" && tab.groupKey === "app:browser"),
        )
        .map((tab) => tab.id),
    ).toEqual([first.id, second.id]);
  });

  it("focuses the owning split when the native page receives a pointer-down", () => {
    const store = useWorkspaceStore.getState();
    store.reset();
    const first = store.openBrowserTab({ url: "https://first.example.com" });
    const firstPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const secondPaneId = store.splitPane(firstPane.id, "right");
    if (!secondPaneId) throw new Error("Expected a second pane");
    const second = store.openBrowserTab({
      url: "https://second.example.com",
      paneId: secondPaneId,
    });
    store.focusTab(first.id);

    const focusEvent = vi.fn();
    window.addEventListener("misty:focus-workspace-tab", focusEvent);
    expect(focusBrowserRuntimeTab(registerBrowserRuntime(second))).toBe(true);
    expect(useWorkspaceStore.getState().layout.focusedPaneId).toBe(secondPaneId);
    expect(
      dockLeaves(useWorkspaceStore.getState().layout.root).find((pane) => pane.id === secondPaneId)
        ?.activeTabId,
    ).toBe(second.id);
    expect(focusEvent).toHaveBeenCalledOnce();
    window.removeEventListener("misty:focus-workspace-tab", focusEvent);
  });
});
