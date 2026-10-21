import { BrowserChromeSlotContext, WindowMenuSlotContext } from "@/features/browser/workspace";
import { useSpaceWindowMenu } from "./SpaceWindowMenu";
import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { PaneSwapMode } from "./PaneSwapMode";
import { routes } from "@/features/app-shell";
import { isSideDock, type DockPosition } from "@/features/app-shell/dockingLayout";
import { useNavigationNames } from "@/features/navigation-names/store";
import { registerShortcutHandler, useShortcutHandler } from "@/features/shortcuts";
import {
  canCloseWorkspaceView,
  dockLeaves,
  findDockLeaf,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { allLayoutViews, layoutTabs } from "@/features/workspace/layoutTabs";
import type { DockSplitDirection } from "@/features/workspace/model";
import { mapAllWorkspaceWindowLayouts } from "@/features/workspace/windows";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { WorkspaceDockTree } from "./WorkspaceDockTree";
import { SidebarDrawer } from "./SidebarDrawer";
import { WorkspaceTabStrip } from "./WorkspaceTabStrip";
import { closePeek, usePeekStore } from "@/features/workspace/peek";
import { resetPinnedTabForView, usePinTabShortcut } from "./usePinTabShortcut";
import { WorkspaceTabPanels } from "./WorkspaceTabPanels";
import { SpaceBar } from "./SpaceBar";
import type { WorkspaceTab } from "@/features/workspace/model";
import { useWorkspaceCanvasShortcuts } from "./useWorkspaceCanvasShortcuts";
import { disposeWorkspaceTab, workspaceTabsById } from "./workspaceViewLifecycle";

export function WorkspaceCanvas(props: {
  tabPosition?: DockPosition;
  titlebarInsets?: { left: number; right: number; animate?: boolean };
  windowsTitlebarControls?: boolean;
  /** Focus mode: pages fill the window without the tab strip. */
  hideTabStrip?: boolean;
  stripFootEnd?: ReactNode;
  /** The vertical sidebar's closing row: the account, sync and settings, inside its panel. */
  stripAccount?: ReactNode;
  /** Lent to the browser: Spaces beside Misty, and the account rows of its menu. */
  browserChrome?: {
    sync: ReactNode;
    accountItems: ReactNode;
  };
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

  // A tab split into panes closes one pane at a time, like stepping on to the next with the pane
  // chips; only its last pane takes the tab with it.
  const closeLayoutTab = useCallback(
    (id: string) => {
      const state = useWorkspaceStore.getState();
      if (state.resetPinnedTab(id)) return;
      const tab = layoutTabs(state.layout).find((candidate) => candidate.id === id);
      const panes = tab ? dockLeaves(tab.root) : [];
      if (tab && panes.length > 1) {
        const pane = panes.find((candidate) => candidate.id === tab.focusedPaneId) ?? panes[0]!;
        const view = pane.views.find((item) => item.id === pane.activeViewId) ?? pane.views[0];
        if (view && state.closeView(view.id, pane.id)) navigateToActiveLayoutTab();
        return;
      }
      if (state.closeTab(id)) navigateToActiveLayoutTab();
    },
    [navigateToActiveLayoutTab],
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
  const pinBlockedNotice = usePinTabShortcut();
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

  useWorkspaceCanvasShortcuts({ openTab, splitWorkspacePane });

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
      onResizeSplit={updateSplitRatio}
    />
  );

  // A lone Agents surface supplies its own compact titlebar. Keep workspace
  // navigation when other tabs/panes/windows or Windows caption buttons need it.
  const standaloneAgents =
    leaves.length === 1 &&
    allLayoutViews(layout).length === 1 &&
    (leaves[0].views[0]?.surfaceId === "agents" || leaves[0].views[0]?.groupKey === "app:agents") &&
    !props.windowsTitlebarControls &&
    !props.titlebarInsets &&
    (props.tabPosition ?? "top") === "top";

  const windowMenuSlot = useSpaceWindowMenu();
  const sideDock = isSideDock(props.tabPosition ?? "top");
  const contentColumn = props.tabPosition === "right" ? 1 : 2;

  return (
    <BrowserChromeSlotContext.Provider value={props.browserChrome ?? null}>
      <WindowMenuSlotContext.Provider value={windowMenuSlot}>
        <div
          className={`h-full min-h-0 min-w-0 overflow-hidden bg-charcoal-workspace ${
            sideDock
              ? `grid grid-rows-[auto_minmax(0,1fr)] ${
                  props.tabPosition === "right"
                    ? "grid-cols-[minmax(0,1fr)_auto]"
                    : "grid-cols-[auto_minmax(0,1fr)]"
                }`
              : "grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]"
          }`}
          data-workspace-panes={leaves.length}
          data-workspace-scope={activeScopeKey}
        >
          {!standaloneAgents &&
            !props.hideTabStrip &&
            (isSideDock(props.tabPosition ?? "top") ? (
              <SidebarDrawer side={props.tabPosition === "right" ? "right" : "left"}>
                <WorkspaceTabStrip
                  position={props.tabPosition}
                  titlebarInsets={props.titlebarInsets}
                  windowsTitlebarControls={props.windowsTitlebarControls}
                  focusedPaneId={layout.focusedPaneId}
                  lastUsedViewByGroup={lastUsedTabByGroup}
                  onOpen={openTab}
                  onClose={closeWorkspaceTab}
                  onNewTab={() => useBrowserSearchStore.getState().show()}
                  onCloseLayoutTab={closeLayoutTab}
                  onMoveView={moveTab}
                  onDockView={dockTab}
                  onSplitPane={splitWorkspacePane}
                  onClosePane={(paneId) => {
                    closePane(paneId);
                    navigateToActiveLayoutTab();
                  }}
                  onResizeSplit={updateSplitRatio}
                  account={props.stripAccount}
                  footEnd={props.stripFootEnd}
                />
              </SidebarDrawer>
            ) : (
              <WorkspaceTabStrip
                position={props.tabPosition}
                titlebarInsets={props.titlebarInsets}
                windowsTitlebarControls={props.windowsTitlebarControls}
                focusedPaneId={layout.focusedPaneId}
                lastUsedViewByGroup={lastUsedTabByGroup}
                onOpen={openTab}
                onClose={closeWorkspaceTab}
                onNewTab={() => useBrowserSearchStore.getState().show()}
                onCloseLayoutTab={closeLayoutTab}
                onMoveView={moveTab}
                onDockView={dockTab}
                onSplitPane={splitWorkspacePane}
                onClosePane={(paneId) => {
                  closePane(paneId);
                  navigateToActiveLayoutTab();
                }}
                onResizeSplit={updateSplitRatio}
                account={props.stripAccount}
                footEnd={props.stripFootEnd}
              />
            ))}
          {sideDock && !standaloneAgents && !props.hideTabStrip ? (
            <SpaceBar gridColumn={contentColumn} />
          ) : null}
          <WorkspaceTabPanels
            gridColumn={sideDock ? contentColumn : undefined}
            layout={layout}
            renderTree={dockTree}
            onClosePeek={() => {
              if (closePeek()) navigateToActiveLayoutTab();
            }}
          />
          {pinBlockedNotice}
          <PaneSwapMode />
        </div>
      </WindowMenuSlotContext.Provider>
    </BrowserChromeSlotContext.Provider>
  );
}
