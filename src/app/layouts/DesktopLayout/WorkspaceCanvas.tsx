import { routes } from "@/features/app-shell";
import { isSideDock, type DockPosition } from "@/features/app-shell/dockingLayout";
import { useNavigationNames } from "@/features/navigation-names/store";
import { registerShortcutHandler, useShortcutHandler } from "@/features/shortcuts";
import {
  canCloseWorkspaceView,
  canCloseWorkspaceWindow,
  canFitDockSplit,
  dockLeaves,
  findDockLeaf,
  maxWorkspacePanels,
  paneBoundsFromDocument,
  paneIdInDirection,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { allLayoutViews, layoutTabs } from "@/features/workspace/layoutTabs";
import type { DockSplitDirection } from "@/features/workspace/model";
import { mapAllWorkspaceWindowLayouts } from "@/features/workspace/windows";
import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { minimumForWorkspaceViews, WorkspaceDockTree } from "./WorkspaceDockTree";
import { WorkspaceTabStrip } from "./WorkspaceTabStrip";
import { closePeek, usePeekStore } from "@/features/workspace/peek";
import { resetPinnedTabForView, usePinTabShortcut } from "./usePinTabShortcut";
import { WorkspaceTabPanels } from "./WorkspaceTabPanels";
import type { WorkspaceTab } from "@/features/workspace/model";
import { useWindowTransition } from "./useWindowTransition";
import { disposeWorkspaceTab, workspaceTabsById } from "./workspaceViewLifecycle";

export function WorkspaceCanvas(props: {
  tabPosition?: DockPosition;
  titlebarInsets?: { left: number; right: number; animate?: boolean };
  windowsTitlebarControls?: boolean;
  /** Focus mode: pages fill the window without the tab strip. */
  hideTabStrip?: boolean;
}) {
  const legacyNames = useNavigationNames((state) => state.names);
  const legacyNamesReady = useNavigationNames((state) => state.ready);
  useEffect(() => {
    if (!legacyNamesReady) return;
    useWorkspaceStore.setState(
      mapAllWorkspaceWindowLayouts(useWorkspaceStore.getState(), (layout) => ({
        ...layout,
        tabs: layoutTabs(layout).map((tab) => {
          if (!tab.legacyNameKeys) return tab;
          const { legacyNameKeys, ...rest } = tab;
          return {
            ...rest,
            title: rest.title ?? legacyNameKeys.map((key) => legacyNames[key]).find(Boolean),
          };
        }),
      })),
    );
  }, [legacyNames, legacyNamesReady]);
  const location = useLocation();
  const navigate = useNavigate();
  const layout = useWorkspaceStore((state) => state.layout);
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const activeVirtualWindowId = useWorkspaceStore((state) => state.activeWindowId);
  const windowTransitionRef = useWindowTransition(activeVirtualWindowId);
  const virtualWindows = useWorkspaceStore(
    (state) => state.windowsByScope[state.activeScopeKey] ?? [],
  );
  const canReopenVirtualWindow = useWorkspaceStore((state) =>
    Boolean(state.closedWindowsByScope[state.activeScopeKey]?.length),
  );
  const lastUsedTabByGroup = useWorkspaceStore((state) => state.lastUsedViewByGroup);
  const focusTab = useWorkspaceStore((state) => state.focusView);
  const closeTab = useWorkspaceStore((state) => state.closeView);
  const splitPane = useWorkspaceStore((state) => state.splitPane);
  const moveTab = useWorkspaceStore((state) => state.moveView);
  const dockTab = useWorkspaceStore((state) => state.dockView);
  const closePane = useWorkspaceStore((state) => state.closePane);
  const updateSplitRatio = useWorkspaceStore((state) => state.updateSplitRatio);
  const leaves = useMemo(() => dockLeaves(layout.root), [layout.root]);

  useEffect(() => {
    let knownTabs = workspaceTabsById(useWorkspaceStore.getState());
    return useWorkspaceStore.subscribe((state) => {
      const nextTabs = workspaceTabsById(state);
      for (const [tabId, tab] of knownTabs) {
        if (!nextTabs.has(tabId)) disposeWorkspaceTab(tab);
      }
      knownTabs = nextTabs;
    });
  }, []);

  const navigateToActiveLayoutTab = useCallback(() => {
    const state = useWorkspaceStore.getState();
    const pane =
      findDockLeaf(state.layout.root, state.layout.focusedPaneId) ??
      dockLeaves(state.layout.root)[0];
    const tab =
      pane?.views.find((candidate) => candidate.id === pane.activeViewId) ?? pane?.views[0];
    // With no tabs left, leave the address bar on a route that maps to no tab so
    // the closed one is not reopened from the URL.
    const route = tab?.route ?? (allLayoutViews(state.layout).length ? null : routes.newTab);
    if (route && `${location.pathname}${location.search}` !== route)
      navigate(route, { replace: true });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    window.addEventListener("misty:workspace-projection-applied", navigateToActiveLayoutTab);
    return () =>
      window.removeEventListener("misty:workspace-projection-applied", navigateToActiveLayoutTab);
  }, [navigateToActiveLayoutTab]);

  const splitWorkspacePane = useCallback(
    (paneId: string, direction: DockSplitDirection, tabId?: string) => {
      const newPaneId = splitPane(paneId, direction, tabId);
      if (newPaneId) window.setTimeout(navigateToActiveLayoutTab, 0);
      return newPaneId;
    },
    [navigateToActiveLayoutTab, splitPane],
  );

  const selectVirtualWindow = useCallback(
    (windowId: string) => {
      if (useWorkspaceStore.getState().switchWindow(windowId))
        window.setTimeout(navigateToActiveLayoutTab, 0);
    },
    [navigateToActiveLayoutTab],
  );

  const createWorkspaceVirtualWindow = useCallback(() => {
    useWorkspaceStore.getState().createWindow();
    window.setTimeout(navigateToActiveLayoutTab, 0);
  }, [navigateToActiveLayoutTab]);

  const reopenWorkspaceVirtualWindow = useCallback(() => {
    if (useWorkspaceStore.getState().reopenClosedWindow())
      window.setTimeout(navigateToActiveLayoutTab, 0);
  }, [navigateToActiveLayoutTab]);

  const closeWorkspaceVirtualWindow = useCallback(
    (windowId: string) => {
      const state = useWorkspaceStore.getState();
      const workspaceWindow = state.windowsByScope[state.activeScopeKey]?.find(
        (candidate) => candidate.id === windowId,
      );
      if (!workspaceWindow || !state.closeWindow(windowId)) return;
      window.setTimeout(navigateToActiveLayoutTab, 0);
    },
    [navigateToActiveLayoutTab],
  );

  const openTab = useCallback(
    (tab: WorkspaceView) => {
      focusTab(tab.id);
      if (`${location.pathname}${location.search}` !== tab.route)
        navigate(tab.route, { replace: true });
    },
    [focusTab, location.pathname, location.search, navigate],
  );

  const closeWorkspaceTab = useCallback(
    (tab: WorkspaceView) => {
      if (resetPinnedTabForView(tab.id)) return;
      if (closeTab(tab.id)) navigateToActiveLayoutTab();
    },
    [closeTab, navigateToActiveLayoutTab],
  );

  const closeActiveTab = useCallback(() => {
    const peek = usePeekStore.getState().peek;
    if (peek && peek.tabId === useWorkspaceStore.getState().layout.activeTabId) {
      if (closePeek()) navigateToActiveLayoutTab();
      return;
    }
    const state = useWorkspaceStore.getState();
    const id = state.layout.activeTabId;
    const pane = findDockLeaf(state.layout.root, state.layout.focusedPaneId);
    if (dockLeaves(state.layout.root).length === 1 && id && state.resetPinnedTab(id)) return;
    const closed =
      dockLeaves(state.layout.root).length > 1
        ? pane?.views[0] && state.closeView(pane.views[0].id)
        : id && state.closeTab(id);
    if (closed) navigateToActiveLayoutTab();
  }, [navigateToActiveLayoutTab]);

  const canCloseActiveTab = useCallback(() => {
    const state = useWorkspaceStore.getState();
    return canCloseWorkspaceView(
      findDockLeaf(state.layout.root, state.layout.focusedPaneId)?.views[0],
    );
  }, []);

  const openSelectedTab = useCallback(
    (tab: WorkspaceView | null) => {
      if (tab && `${location.pathname}${location.search}` !== tab.route)
        navigate(tab.route, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  useShortcutHandler("workspace.close_tab", closeActiveTab, canCloseActiveTab);
  usePinTabShortcut();
  useShortcutHandler(
    "workspace.reopen_tab",
    useCallback(
      () => openSelectedTab(useWorkspaceStore.getState().reopenClosedView()),
      [openSelectedTab],
    ),
  );
  useShortcutHandler(
    "workspace.next_tab",
    useCallback(
      () => openSelectedTab(useWorkspaceStore.getState().cycleView(1)),
      [openSelectedTab],
    ),
  );
  useShortcutHandler(
    "workspace.previous_tab",
    useCallback(
      () => openSelectedTab(useWorkspaceStore.getState().cycleView(-1)),
      [openSelectedTab],
    ),
  );
  useShortcutHandler(
    "workspace.new_tab",
    useCallback(() => {
      const view = useWorkspaceStore.getState().newTab();
      openSelectedTab(view);
    }, [openSelectedTab]),
  );
  useEffect(() => {
    const unregister = Array.from({ length: 9 }, (_, index) =>
      registerShortcutHandler(`workspace.tab_${index + 1}`, () => {
        const state = useWorkspaceStore.getState();
        const tab = state.selectView(index === 8 ? "last" : index);
        openSelectedTab(tab);
      }),
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
        pane?.views.find((candidate) => candidate.id === pane.activeViewId) ?? pane?.views[0];
      if (tab) openTab(tab);
      else if (pane) state.focusPane(pane.id);
    };
    const canSplitFocusedPane = (direction: "right" | "down") => {
      const state = useWorkspaceStore.getState();
      if (dockLeaves(state.layout.root).length >= maxWorkspacePanels) return false;
      const pane = findDockLeaf(state.layout.root, state.layout.focusedPaneId);
      const bounds = paneBoundsFromDocument().find((candidate) => candidate.id === pane?.id);
      if (!pane || !bounds) return false;
      return canFitDockSplit(bounds, direction, minimumForWorkspaceViews(pane.views), {
        width: 360,
        height: 240,
      });
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
      registerShortcutHandler(
        "workspace.split_right",
        () => {
          const state = useWorkspaceStore.getState();
          splitWorkspacePane(state.layout.focusedPaneId, "right");
        },
        () => canSplitFocusedPane("right"),
      ),
      registerShortcutHandler(
        "workspace.split_down",
        () => {
          const state = useWorkspaceStore.getState();
          splitWorkspacePane(state.layout.focusedPaneId, "down");
        },
        () => canSplitFocusedPane("down"),
      ),
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
  }, [openTab, splitWorkspacePane]);

  useEffect(() => {
    const hasMultipleVirtualWindows = () => {
      const state = useWorkspaceStore.getState();
      return (state.windowsByScope[state.activeScopeKey]?.length ?? 0) > 1;
    };
    const cycleWindow = (direction: 1 | -1) => {
      const state = useWorkspaceStore.getState();
      const windows = state.windowsByScope[state.activeScopeKey] ?? [];
      if (windows.length < 2) return;
      const index = Math.max(
        0,
        windows.findIndex((window) => window.id === state.activeWindowId),
      );
      selectVirtualWindow(windows[(index + direction + windows.length) % windows.length].id);
    };
    const unregister = [
      registerShortcutHandler("workspace.new_virtual_window", () => {
        createWorkspaceVirtualWindow();
      }),
      registerShortcutHandler(
        "workspace.close_virtual_window",
        () => closeWorkspaceVirtualWindow(useWorkspaceStore.getState().activeWindowId),
        () => {
          const state = useWorkspaceStore.getState();
          const windows = state.windowsByScope[state.activeScopeKey] ?? [];
          const active = windows.find(
            (workspaceWindow) => workspaceWindow.id === state.activeWindowId,
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
          return Boolean(state.closedWindowsByScope[state.activeScopeKey]?.length);
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
            const workspaceWindow = state.windowsByScope[state.activeScopeKey]?.[index];
            if (workspaceWindow) selectVirtualWindow(workspaceWindow.id);
          },
          () => {
            const state = useWorkspaceStore.getState();
            return Boolean(state.windowsByScope[state.activeScopeKey]?.[index]);
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
      if (!workspace.focusView(tabId)) return;
      const tab = dockLeaves(useWorkspaceStore.getState().layout.root)
        .flatMap((pane) => pane.views)
        .find((candidate) => candidate.id === tabId);
      openSelectedTab(tab ?? null);
    };
    window.addEventListener("misty:focus-workspace-tab", focusRequestedTab);
    return () => window.removeEventListener("misty:focus-workspace-tab", focusRequestedTab);
  }, [openSelectedTab]);

  const dockTree = (tab: WorkspaceTab, active: boolean) => (
    <WorkspaceDockTree
      node={tab.root}
      workspaceActive={active}
      focusedPaneId={tab.focusedPaneId}
      lastUsedViewByGroup={lastUsedTabByGroup}
      onOpen={openTab}
      onClose={closeWorkspaceTab}
      onMoveView={moveTab}
      onDockView={dockTab}
      onSplitPane={splitWorkspacePane}
      onClosePane={(paneId) => {
        closePane(paneId);
        navigateToActiveLayoutTab();
      }}
      windows={virtualWindows}
      activeWindowId={activeVirtualWindowId}
      canReopenWindow={canReopenVirtualWindow}
      onSelectWindow={selectVirtualWindow}
      onCreateWindow={createWorkspaceVirtualWindow}
      onCloseWindow={closeWorkspaceVirtualWindow}
      onReopenWindow={reopenWorkspaceVirtualWindow}
      onResizeSplit={updateSplitRatio}
    />
  );

  // A lone Agents surface supplies its own compact titlebar. Keep workspace
  // navigation when other tabs/panes/windows or Windows caption buttons need it.
  const standaloneAgents =
    leaves.length === 1 &&
    allLayoutViews(layout).length === 1 &&
    (leaves[0].views[0]?.surfaceId === "agents" || leaves[0].views[0]?.groupKey === "app:agents") &&
    virtualWindows.length <= 1 &&
    !props.windowsTitlebarControls &&
    !props.titlebarInsets &&
    (props.tabPosition ?? "top") === "top";

  return (
    <div
      ref={windowTransitionRef}
      className={`flex h-full min-h-0 min-w-0 overflow-hidden bg-charcoal-border ${isSideDock(props.tabPosition ?? "top") ? "flex-row" : "flex-col"}`}
      data-workspace-panes={leaves.length}
      data-workspace-scope={activeScopeKey}
      data-virtual-window={activeVirtualWindowId}
    >
      {!standaloneAgents && !props.hideTabStrip && (
        <WorkspaceTabStrip
          position={props.tabPosition}
          titlebarInsets={props.titlebarInsets}
          windowsTitlebarControls={props.windowsTitlebarControls}
          focusedPaneId={layout.focusedPaneId}
          lastUsedViewByGroup={lastUsedTabByGroup}
          onOpen={openTab}
          onClose={closeWorkspaceTab}
          onNewTab={() => openTab(useWorkspaceStore.getState().newTab())}
          onCloseLayoutTab={(id) => {
            const state = useWorkspaceStore.getState();
            if (state.resetPinnedTab(id)) return;
            if (state.closeTab(id)) navigateToActiveLayoutTab();
          }}
          onMoveView={moveTab}
          onDockView={dockTab}
          onSplitPane={splitWorkspacePane}
          onClosePane={(paneId) => {
            closePane(paneId);
            navigateToActiveLayoutTab();
          }}
          windows={virtualWindows}
          activeWindowId={activeVirtualWindowId}
          canReopenWindow={canReopenVirtualWindow}
          onSelectWindow={selectVirtualWindow}
          onCreateWindow={createWorkspaceVirtualWindow}
          onCloseWindow={closeWorkspaceVirtualWindow}
          onReopenWindow={reopenWorkspaceVirtualWindow}
          onResizeSplit={updateSplitRatio}
        />
      )}
      <WorkspaceTabPanels
        layout={layout}
        renderTree={dockTree}
        onClosePeek={() => {
          if (closePeek()) navigateToActiveLayoutTab();
        }}
      />
    </div>
  );
}
