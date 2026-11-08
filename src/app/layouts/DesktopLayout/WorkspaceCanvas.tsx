import { useBrowserSearchStore } from "@/features/browser";
import { PaneSwapMode } from "./PaneSwapMode";
import { routes } from "@/app/shell";
import type { TabSide } from "@/app/shell/dockingLayout";
import {
  dockLeaves,
  findDockLeaf,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/app-windows";
import { allLayoutViews, layoutTabs } from "@/features/app-windows";
import type { DockSplitDirection } from "@/features/app-windows";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { WorkspaceDockTree } from "./WorkspaceDockTree";
import { SidebarDrawer } from "./SidebarDrawer";
import { WorkspaceTabStrip } from "./WorkspaceTabStrip";
import { closePeek } from "@/features/app-windows";
import {
  resetPinnedTabForView,
  useClearTabsShortcut,
  usePinTabShortcut,
} from "./usePinTabShortcut";
import { WorkspaceTabPanels } from "./WorkspaceTabPanels";
import { SpaceBar } from "./SpaceBar";
import type { WorkspaceTab } from "@/features/app-windows";
import { useWorkspaceCanvasShortcuts } from "./useWorkspaceCanvasShortcuts";
import { useLegacyTabTitles, useWorkspaceTabShortcuts } from "./useWorkspaceTabShortcuts";
import { disposeWorkspaceTab, workspaceTabsById } from "./workspaceViewLifecycle";

export function WorkspaceCanvas(props: {
  /** The side of the window the tab sidebar sits on. */
  tabPosition?: TabSide;
  windowsTitlebarControls?: boolean;
  /** Focus mode: pages fill the window without the tab strip. */
  hideTabStrip?: boolean;
  stripFootEnd?: ReactNode;
  /** The vertical sidebar's closing row: the account and settings, inside its panel. */
  stripAccount?: ReactNode;
}) {
  useLegacyTabTitles();
  const location = useLocation();
  const navigate = useNavigate();
  const layout = useWorkspaceStore((state) => state.layout);
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

  useWorkspaceTabShortcuts(navigateToActiveLayoutTab);
  usePinTabShortcut();
  useClearTabsShortcut();
  useWorkspaceCanvasShortcuts({ openTab, splitWorkspacePane });

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

  const side = props.tabPosition ?? "left";
  const contentColumn = side === "right" ? 1 : 2;

  return (
    <>
      {/* Clipped, not hidden: a collapsed right sidebar waits past this edge, and scrolling its
          active tab into view must not scroll the Space bar and page sideways. */}
      <div
        className={`grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-clip bg-charcoal-workspace ${
          side === "right" ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)]"
        }`}
        data-workspace-panes={leaves.length}
      >
        {!props.hideTabStrip ? (
          <>
            <SidebarDrawer side={side}>
              <WorkspaceTabStrip
                position={side}
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
            <SpaceBar gridColumn={contentColumn} side={side} />
          </>
        ) : null}
        <WorkspaceTabPanels
          gridColumn={contentColumn}
          layout={layout}
          renderTree={dockTree}
          onClosePeek={() => {
            if (closePeek()) navigateToActiveLayoutTab();
          }}
        />
        <PaneSwapMode />
      </div>
    </>
  );
}
