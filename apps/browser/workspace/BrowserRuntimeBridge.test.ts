import { afterEach, describe, expect, it, vi } from "vitest";
import { createDockLeaf, dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { initialWorkspaceLayout } from "@/features/workspace/virtualWindows";
import { allLayoutViews } from "@/features/workspace/layoutTabs";
import {
  activeBrowserSurfaceExists,
  browserBlockingOverlayOpen,
  focusBrowserRuntimeTab,
} from "./BrowserRuntimeBridge";
import { registerBrowserRuntime } from "./browserRuntime";
import { providers } from "../../shared/providers";

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
      {
        id: "app-browser",
        surfaceId: "official-app",
        groupKey: "app:browser",
      } as never,
    ]);
    expect(activeBrowserSurfaceExists(root)).toBe(true);
    root.tabs[0].groupKey = "app:planner";
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
      allLayoutViews(useWorkspaceStore.getState().layout)
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

it.each([
  ...Object.entries(providers).map(([id, policy]) => [
    policy.family,
    `/apps/${policy.family === "chat" ? "social" : policy.family}?provider=${id}`,
  ]),
  ["journal", "/apps/journal?provider=google-docs"],
  ["planner", "/apps/planner?provider=jira"],
  ["inbox", "/apps/inbox?provider=google"],
  ["inbox", "/apps/inbox?provider=google&experience=api"],
  ["inbox", "/apps/inbox?provider=microsoft"],
  ["chat", "/apps/social?provider=instagram"],
  ["chat", "/apps/social?provider=messenger"],
  ["chat", "/apps/social?provider=x"],
  ["chat", "/apps/social?provider=discord"],
])("keeps the active %s provider page visible when switching from Browser: %s", (app, route) => {
  const root = createDockLeaf([
    {
      id: "browser",
      surfaceId: "official-app",
      groupKey: "app:browser",
      route: "/apps/browser",
    } as never,
    {
      id: "provider",
      surfaceId: "official-app",
      groupKey: `app:${app}`,
      route,
    } as never,
    { id: "home", surfaceId: "home", groupKey: "home", route: "/" } as never,
  ]);
  for (const id of ["browser", "provider", "browser", "provider"]) {
    root.activeTabId = id;
    expect(activeBrowserSurfaceExists(root)).toBe(true);
  }
  root.activeTabId = "home";
  expect(activeBrowserSurfaceExists(root)).toBe(false);
  root.activeTabId = "provider";
  expect(activeBrowserSurfaceExists(root)).toBe(true);
});
it.each([
  ["chat", "/apps/social?provider=misty"],
  ["journal", "/apps/journal?provider=misty&view=drawings"],
  ["planner", "/apps/planner?view=integrations"],
  ["chat", "/apps/social?provider=messenger&experience=api"],
])("does not keep native content visible over a non-website %s view: %s", (app, route) => {
  const root = createDockLeaf([
    {
      id: "native",
      surfaceId: "official-app",
      groupKey: `app:${app}`,
      route,
    } as never,
  ]);
  expect(activeBrowserSurfaceExists(root)).toBe(false);
});
