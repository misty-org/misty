import { closeBrowserRuntime } from "@/features/browser";
import { toggleDesktopMistyPanel } from "@/features/desktop-pet";
import { useGlobalSearchStore } from "@/features/global-search";
import { preferredMistySpace, useSpacesStore } from "@/features/spaces";
import { killTerminalTab } from "@/features/terminal";
import { registerShortcutHandler, useShortcutHandler } from "@/features/shortcuts";
import {
  canCloseWorkspaceTab,
  canCloseWorkspaceWindow,
  dockLeaves,
  dockTabs,
  dockWidgetRegistry,
  findDockLeaf,
  nextTabTitle,
  paneBoundsFromDocument,
  paneIdInDirection,
  parseCodeTabState,
  toolIdFromSurfaceId,
  toolIdFromTab,
  useRecentToolsStore,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type WorkspaceGroupKey,
  type WorkspaceTab,
} from "@/features/workspace";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { WorkspaceDockTree } from "./WorkspaceDockTree";
import type { NewTabOption } from "./WorkspaceNewTabMenu";
import { useVirtualWindowTransition } from "./useVirtualWindowTransition";

export function WorkspaceCanvas(props: {
  outlet: ReactNode;
  titlebarInsets?: { left: number; right: number };
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const spaces = useSpacesStore((state) => state.spaces);
  const layout = useWorkspaceStore((state) => state.layout);
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const activeVirtualWindowId = useWorkspaceStore((state) => state.activeVirtualWindowId);
  const windowTransitionRef = useVirtualWindowTransition(activeVirtualWindowId);
  const virtualWindows = useWorkspaceStore(
    (state) => state.virtualWindowsByScope[state.activeScopeKey] ?? [],
  );
  const canReopenVirtualWindow = useWorkspaceStore((state) =>
    Boolean(state.closedVirtualWindowsByScope[state.activeScopeKey]?.length),
  );
  const lastUsedTabByGroup = useWorkspaceStore((state) => state.lastUsedTabByGroup);
  const focusTab = useWorkspaceStore((state) => state.focusTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const openBrowserTab = useWorkspaceStore((state) => state.openBrowserTab);
  const openSurface = useWorkspaceStore((state) => state.openSurface);
  const splitPane = useWorkspaceStore((state) => state.splitPane);
  const moveTab = useWorkspaceStore((state) => state.moveTab);
  const dockTab = useWorkspaceStore((state) => state.dockTab);
  const closePane = useWorkspaceStore((state) => state.closePane);
  const updateSplitRatio = useWorkspaceStore((state) => state.updateSplitRatio);
  const leaves = useMemo(() => dockLeaves(layout.root), [layout.root]);
  const tabCount = useMemo(() => dockTabs(layout.root).length, [layout.root]);

  useEffect(() => {
    if (tabCount > 0 || spaces.length === 0) return;

    // Give route synchronization a chance to open the requested app first.
    // If the workspace is still empty, Home becomes the single fallback tab.
    const timer = window.setTimeout(() => {
      const workspace = useWorkspaceStore.getState();
      if (dockTabs(workspace.layout.root).length > 0) return;
      const scopedSpaceId = workspace.activeScopeKey.startsWith("space:")
        ? workspace.activeScopeKey.slice(6)
        : "";
      const homeSpace =
        spaces.find((space) => space.id === scopedSpaceId) ?? preferredMistySpace(spaces);
      if (!homeSpace) return;
      const route = `/spaces/${encodeURIComponent(homeSpace.id)}/home`;
      const request = workspaceSurfaceFromRoute(route);
      if (!request) return;
      const homeTab = workspace.openSurface(request);
      if (`${location.pathname}${location.search}` !== homeTab.route) {
        navigate(homeTab.route, { replace: true });
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeScopeKey, location.pathname, location.search, navigate, spaces, tabCount]);

  const navigateToActiveLayoutTab = useCallback(() => {
    const state = useWorkspaceStore.getState();
    const pane =
      findDockLeaf(state.layout.root, state.layout.focusedPaneId) ??
      dockLeaves(state.layout.root)[0];
    const tab = pane?.tabs.find((candidate) => candidate.id === pane.activeTabId) ?? pane?.tabs[0];
    if (tab && `${location.pathname}${location.search}` !== tab.route) navigate(tab.route);
  }, [location.pathname, location.search, navigate]);

  const selectVirtualWindow = useCallback(
    (windowId: string) => {
      if (useWorkspaceStore.getState().switchVirtualWindow(windowId))
        window.setTimeout(navigateToActiveLayoutTab, 0);
    },
    [navigateToActiveLayoutTab],
  );

  const createWorkspaceVirtualWindow = useCallback(() => {
    useWorkspaceStore.getState().createVirtualWindow();
    window.setTimeout(navigateToActiveLayoutTab, 0);
  }, [navigateToActiveLayoutTab]);

  const reopenWorkspaceVirtualWindow = useCallback(() => {
    if (useWorkspaceStore.getState().reopenClosedVirtualWindow())
      window.setTimeout(navigateToActiveLayoutTab, 0);
  }, [navigateToActiveLayoutTab]);

  const closeWorkspaceVirtualWindow = useCallback(
    (windowId: string) => {
      const state = useWorkspaceStore.getState();
      const workspaceWindow = state.virtualWindowsByScope[state.activeScopeKey]?.find(
        (candidate) => candidate.id === windowId,
      );
      if (!workspaceWindow || !state.closeVirtualWindow(windowId)) return;
      for (const tab of dockLeaves(workspaceWindow.layout.root).flatMap((pane) => pane.tabs)) {
        if (tab.surfaceId === "browser") void closeBrowserRuntime(tab);
        if (tab.surfaceId === "terminal") killTerminalTab(tab.id);
        dockWidgetRegistry.get(tab.surfaceId).dispose?.(tab.state);
      }
      window.setTimeout(navigateToActiveLayoutTab, 0);
    },
    [navigateToActiveLayoutTab],
  );

  const openTab = useCallback(
    (tab: WorkspaceTab) => {
      focusTab(tab.id);
      useRecentToolsStore.getState().recordToolUsage(toolIdFromTab(tab));
      if (`${location.pathname}${location.search}` !== tab.route) navigate(tab.route);
    },
    [focusTab, location.pathname, location.search, navigate],
  );

  const closeWorkspaceTab = useCallback(
    (tab: WorkspaceTab) => {
      if (!closeTab(tab.id)) return;
      if (tab.surfaceId === "browser") void closeBrowserRuntime(tab);
      if (tab.surfaceId === "terminal") killTerminalTab(tab.id);
      dockWidgetRegistry.get(tab.surfaceId).dispose?.(tab.state);
      const state = useWorkspaceStore.getState();
      const leaves = dockLeaves(state.layout.root);
      const focusedPane =
        leaves.find((pane) => pane.id === state.layout.focusedPaneId) ?? leaves[0];
      const nextActive =
        focusedPane?.tabs.find((t) => t.id === focusedPane.activeTabId) ?? focusedPane?.tabs[0];
      if (nextActive && `${location.pathname}${location.search}` !== nextActive.route) {
        navigate(nextActive.route);
      }
    },
    [closeTab, location.pathname, location.search, navigate],
  );

  const openNewTab = useCallback(
    (option: NewTabOption, paneId: string) => {
      useRecentToolsStore
        .getState()
        .recordToolUsage(toolIdFromSurfaceId(option.surfaceId, option.label));
      if (option.surfaceId === "browser") return openTab(openBrowserTab({ paneId }));
      const state = useWorkspaceStore.getState();
      const targetPane =
        findDockLeaf(state.layout.root, paneId) ??
        findDockLeaf(state.layout.root, state.layout.focusedPaneId);
      const tabTitle = nextTabTitle(targetPane?.tabs, option.surfaceId, option.label);
      if (option.surfaceId === "space") {
        const surfaceReq = workspaceSurfaceFromRoute(option.route);
        if (surfaceReq) {
          return openTab(
            openSurface({
              ...surfaceReq,
              title: tabTitle,
              forceNew: true,
              instancePolicy: "multiple",
              paneId,
              state: dockWidgetRegistry.get("space").create(),
            }),
          );
        }
      }
      if (option.surfaceId === "code") {
        const currentCode = targetPane?.tabs.find(
          (tab) => tab.id === targetPane.activeTabId && tab.surfaceId === "code",
        );
        const currentState = parseCodeTabState(currentCode?.state);
        return openTab(
          openSurface({
            surfaceId: "code",
            groupKey: "tool:code",
            title: tabTitle,
            route: option.route,
            instancePolicy: "multiple",
            forceNew: true,
            paneId,
            state: { ...currentState, viewport: { kind: "file", activeFilePath: null } },
          }),
        );
      }
      openTab(
        openSurface({
          surfaceId: option.surfaceId,
          groupKey: `tool:${option.surfaceId}` as WorkspaceGroupKey,
          title: tabTitle,
          route: option.route,
          instancePolicy: option.instancePolicy ?? "multiple",
          forceNew: true,
          paneId,
          state: dockWidgetRegistry.get(option.surfaceId).create(),
        }),
      );
    },
    [openBrowserTab, openSurface, openTab],
  );

  const closeActiveTab = useCallback(() => {
    const state = useWorkspaceStore.getState();
    const focused = findDockLeaf(state.layout.root, state.layout.focusedPaneId);
    const active = focused?.tabs.find((tab) => tab.id === focused.activeTabId);
    if (active) closeWorkspaceTab(active);
  }, [closeWorkspaceTab]);

  const canCloseActiveTab = useCallback(() => {
    const state = useWorkspaceStore.getState();
    const focused = findDockLeaf(state.layout.root, state.layout.focusedPaneId);
    const active = focused?.tabs.find((tab) => tab.id === focused.activeTabId);
    const scopedTabs = virtualWindows.flatMap((workspaceWindow) =>
      dockTabs(workspaceWindow.layout.root),
    );
    return Boolean(active && canCloseWorkspaceTab(active, scopedTabs));
  }, [virtualWindows]);

  const openSelectedTab = useCallback(
    (tab: WorkspaceTab | null) => {
      if (tab && `${location.pathname}${location.search}` !== tab.route) navigate(tab.route);
    },
    [location.pathname, location.search, navigate],
  );

  useShortcutHandler("workspace.close_tab", closeActiveTab, canCloseActiveTab);
  useShortcutHandler(
    "misty.contextual_companion",
    useCallback(() => {
      void toggleDesktopMistyPanel().then((openedNativePanel) => {
        if (!openedNativePanel) useGlobalSearchStore.getState().togglePanel();
      });
    }, []),
  );
  useShortcutHandler(
    "workspace.reopen_tab",
    useCallback(
      () => openSelectedTab(useWorkspaceStore.getState().reopenClosedTab()),
      [openSelectedTab],
    ),
  );
  useShortcutHandler(
    "workspace.next_tab",
    useCallback(() => openSelectedTab(useWorkspaceStore.getState().cycleTab(1)), [openSelectedTab]),
  );
  useShortcutHandler(
    "workspace.previous_tab",
    useCallback(
      () => openSelectedTab(useWorkspaceStore.getState().cycleTab(-1)),
      [openSelectedTab],
    ),
  );
  useShortcutHandler(
    "workspace.new_tab",
    useCallback(() => {
      const paneId = useWorkspaceStore.getState().layout.focusedPaneId;
      window.dispatchEvent(new CustomEvent("misty:open-new-tab-picker", { detail: { paneId } }));
    }, []),
  );
  useEffect(() => {
    const unregister = Array.from({ length: 9 }, (_, index) =>
      registerShortcutHandler(`workspace.tab_${index + 1}`, () =>
        openSelectedTab(useWorkspaceStore.getState().selectTab(index === 8 ? "last" : index)),
      ),
    );
    return () => unregister.forEach((remove) => remove());
  }, [openSelectedTab]);

  useEffect(() => {
    const paneInDirection = (direction: "left" | "right" | "up" | "down") => {
      const state = useWorkspaceStore.getState();
      return paneIdInDirection(state.layout.focusedPaneId, direction, paneBoundsFromDocument());
    };
    const focusPane = (direction: "left" | "right" | "up" | "down") => {
      const state = useWorkspaceStore.getState();
      const paneId = paneInDirection(direction);
      const pane = paneId ? findDockLeaf(state.layout.root, paneId) : null;
      const tab =
        pane?.tabs.find((candidate) => candidate.id === pane.activeTabId) ?? pane?.tabs[0];
      if (tab) openTab(tab);
    };
    const unregister = [
      registerShortcutHandler(
        "workspace.focus_pane_left",
        () => focusPane("left"),
        () => Boolean(paneInDirection("left")),
      ),
      registerShortcutHandler(
        "workspace.focus_pane_up",
        () => focusPane("up"),
        () => Boolean(paneInDirection("up")),
      ),
      registerShortcutHandler(
        "workspace.focus_pane_right",
        () => focusPane("right"),
        () => Boolean(paneInDirection("right")),
      ),
      registerShortcutHandler(
        "workspace.focus_pane_down",
        () => focusPane("down"),
        () => Boolean(paneInDirection("down")),
      ),
      registerShortcutHandler("workspace.split_right", () => {
        const state = useWorkspaceStore.getState();
        state.splitPane(state.layout.focusedPaneId, "right");
      }),
      registerShortcutHandler("workspace.split_down", () => {
        const state = useWorkspaceStore.getState();
        state.splitPane(state.layout.focusedPaneId, "down");
      }),
      registerShortcutHandler(
        "workspace.close_pane",
        () => {
          const state = useWorkspaceStore.getState();
          state.closePane(state.layout.focusedPaneId);
        },
        () => dockLeaves(useWorkspaceStore.getState().layout.root).length > 1,
      ),
    ];
    return () => unregister.forEach((remove) => remove());
  }, [openTab]);

  useEffect(() => {
    const hasMultipleVirtualWindows = () => {
      const state = useWorkspaceStore.getState();
      return (state.virtualWindowsByScope[state.activeScopeKey]?.length ?? 0) > 1;
    };
    const cycleWindow = (direction: 1 | -1) => {
      const state = useWorkspaceStore.getState();
      const windows = state.virtualWindowsByScope[state.activeScopeKey] ?? [];
      if (windows.length < 2) return;
      const index = Math.max(
        0,
        windows.findIndex((window) => window.id === state.activeVirtualWindowId),
      );
      selectVirtualWindow(windows[(index + direction + windows.length) % windows.length].id);
    };
    const unregister = [
      registerShortcutHandler("workspace.new_virtual_window", () => {
        createWorkspaceVirtualWindow();
      }),
      registerShortcutHandler(
        "workspace.close_virtual_window",
        () => closeWorkspaceVirtualWindow(useWorkspaceStore.getState().activeVirtualWindowId),
        () => {
          const state = useWorkspaceStore.getState();
          const windows = state.virtualWindowsByScope[state.activeScopeKey] ?? [];
          const active = windows.find(
            (workspaceWindow) => workspaceWindow.id === state.activeVirtualWindowId,
          );
          return Boolean(active && windows.length > 1 && canCloseWorkspaceWindow(active, windows));
        },
      ),
      registerShortcutHandler(
        "workspace.next_virtual_window",
        () => cycleWindow(1),
        hasMultipleVirtualWindows,
      ),
      registerShortcutHandler(
        "workspace.previous_virtual_window",
        () => cycleWindow(-1),
        hasMultipleVirtualWindows,
      ),
      registerShortcutHandler(
        "workspace.reopen_virtual_window",
        reopenWorkspaceVirtualWindow,
        () => {
          const state = useWorkspaceStore.getState();
          return Boolean(state.closedVirtualWindowsByScope[state.activeScopeKey]?.length);
        },
      ),
      registerShortcutHandler("workspace.swap_panel_next", () => {
        const state = useWorkspaceStore.getState();
        const panes = dockLeaves(state.layout.root);
        if (panes.length < 2) return;
        const index = Math.max(
          0,
          panes.findIndex((pane) => pane.id === state.layout.focusedPaneId),
        );
        state.swapPanes(panes[index].id, panes[(index + 1) % panes.length].id);
      }),
      ...Array.from({ length: 9 }, (_, index) =>
        registerShortcutHandler(
          `workspace.window_${index + 1}`,
          () => {
            const state = useWorkspaceStore.getState();
            const workspaceWindow = state.virtualWindowsByScope[state.activeScopeKey]?.[index];
            if (workspaceWindow) selectVirtualWindow(workspaceWindow.id);
          },
          () => {
            const state = useWorkspaceStore.getState();
            return Boolean(state.virtualWindowsByScope[state.activeScopeKey]?.[index]);
          },
        ),
      ),
    ];
    return () => unregister.forEach((remove) => remove());
  }, [
    closeWorkspaceVirtualWindow,
    createWorkspaceVirtualWindow,
    navigateToActiveLayoutTab,
    reopenWorkspaceVirtualWindow,
    selectVirtualWindow,
  ]);

  useEffect(() => {
    const focusRequestedTab = (event: Event) => {
      const tabId = (event as CustomEvent<{ tabId?: string }>).detail?.tabId;
      if (!tabId) return;
      const workspace = useWorkspaceStore.getState();
      if (!workspace.focusTab(tabId)) return;
      const tab = dockLeaves(useWorkspaceStore.getState().layout.root)
        .flatMap((pane) => pane.tabs)
        .find((candidate) => candidate.id === tabId);
      openSelectedTab(tab ?? null);
    };
    window.addEventListener("misty:focus-workspace-tab", focusRequestedTab);
    return () => window.removeEventListener("misty:focus-workspace-tab", focusRequestedTab);
  }, [openSelectedTab]);

  return (
    <div
      ref={windowTransitionRef}
      className="h-full min-h-0 overflow-hidden bg-charcoal-border"
      data-workspace-panes={leaves.length}
      data-workspace-scope={activeScopeKey}
      data-virtual-window={activeVirtualWindowId}
    >
      <WorkspaceDockTree
        node={layout.root}
        dockEdge={{ top: true, left: true, right: true }}
        titlebarInsets={props.titlebarInsets}
        focusedPaneId={layout.focusedPaneId}
        locationPath={location.pathname}
        locationSearch={location.search}
        outlet={props.outlet}
        lastUsedTabByGroup={lastUsedTabByGroup}
        onOpen={openTab}
        onClose={closeWorkspaceTab}
        onOpenNewTab={openNewTab}
        onMoveTab={moveTab}
        onDockTab={dockTab}
        onSplitPane={splitPane}
        onClosePane={closePane}
        virtualWindows={virtualWindows}
        activeVirtualWindowId={activeVirtualWindowId}
        canReopenVirtualWindow={canReopenVirtualWindow}
        onSelectVirtualWindow={selectVirtualWindow}
        onCreateVirtualWindow={createWorkspaceVirtualWindow}
        onCloseVirtualWindow={closeWorkspaceVirtualWindow}
        onReopenVirtualWindow={reopenWorkspaceVirtualWindow}
        onResizeSplit={updateSplitRatio}
      />
    </div>
  );
}
