import { PaneSwapMode } from "./PaneSwapMode";
import { routes } from "@/app/shell";
import type { TabSide } from "@/app/shell/dockingLayout";
import {
  dockLeaves,
  findDockLeaf,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/app-windows";
import { allLayoutViews } from "@/features/app-windows";
import type { DockSplitDirection } from "@/features/app-windows";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { WorkspaceDockTree } from "./WorkspaceDockTree";
import { SidebarDrawer } from "./SidebarDrawer";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { useClearTabsShortcut } from "./useClearTabsShortcut";
import { WorkspaceTabPanels } from "./WorkspaceTabPanels";
import { WorkspaceBottomBar } from "./WorkspaceBottomBar";
import { TopEdge } from "./TopEdge";
import { LayoutPopup } from "./LayoutPopup";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { WorkspaceSearch } from "./search/WorkspaceSearch";
import { AgentsHub } from "./AgentsHub";
import { agentChatRoute, openNewChat, openWorkspaceRoute } from "./spaceNavigation";
import { TrayAgentsSync } from "@/features/agents";
import type { WorkspaceTab } from "@/features/app-windows";
import { useWorkspaceCanvasShortcuts } from "./useWorkspaceCanvasShortcuts";
import { useWorkspaceTabShortcuts } from "./useWorkspaceTabShortcuts";
import { disposeWorkspaceTab, workspaceTabsById } from "./workspaceViewLifecycle";
import { Surface } from "@/shared/ui";

export function WorkspaceCanvas(props: {
  /** The side of the window the sidebar sits on. */
  tabPosition?: TabSide;
  windowsTitlebarControls?: boolean;
  /** Focus mode: pages fill the window without the sidebar. */
  hideTabStrip?: boolean;
  /** The vertical sidebar's closing row: the account and settings, inside its panel. */
  stripAccount?: ReactNode;
}) {
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

  // Once per window: a saved window loads without the web pages it held, so the address may
  // name one. With pages left, the address follows the one now in front. With none, a window
  // that was on a web page opens Agents; any other address opens its own page.
  const followedSavedPages = useRef(false);
  useEffect(() => {
    if (followedSavedPages.current) return;
    followedSavedPages.current = true;
    if (allLayoutViews(useWorkspaceStore.getState().layout).length) navigateToActiveLayoutTab();
    else if (location.pathname === routes.newTab) navigate(routes.agents, { replace: true });
  }, [location.pathname, navigate, navigateToActiveLayoutTab]);

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
      if (closeTab(tab.id)) navigateToActiveLayoutTab();
    },
    [closeTab, navigateToActiveLayoutTab],
  );

  useWorkspaceTabShortcuts(navigateToActiveLayoutTab);
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
          active tab into view must not scroll the page sideways. */}
      <Surface
        tone="chrome"
        className={`grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-clip ${
          side === "right" ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)]"
        }`}
        data-workspace-panes={leaves.length}
      >
        {!props.hideTabStrip ? (
          <>
            <SidebarDrawer side={side}>
              <WorkspaceSidebar
                position={side}
                windowsTitlebarControls={props.windowsTitlebarControls}
                onOpen={openTab}
                account={props.stripAccount}
              />
            </SidebarDrawer>
            <TopEdge gridColumn={contentColumn} side={side} />
            <WorkspaceTabBar
              gridColumn={contentColumn}
              onOpen={openTab}
              onClosed={navigateToActiveLayoutTab}
            />
          </>
        ) : null}
        <WorkspaceTabPanels gridColumn={contentColumn} layout={layout} renderTree={dockTree} />
        {!props.hideTabStrip ? (
          <WorkspaceBottomBar gridColumn={contentColumn} onOpen={openTab} />
        ) : null}
        <PaneSwapMode />
        <LayoutPopup onApplied={navigateToActiveLayoutTab} />
        <WorkspaceSearch onOpen={openTab} />
        <AgentsHub onOpen={openTab} />
        <TrayAgentsSync
          onOpenChat={(agentId, chatId) =>
            openWorkspaceRoute(agentChatRoute(agentId, chatId), openTab)
          }
          onNewChat={() => openNewChat(openTab)}
        />
      </Surface>
    </>
  );
}
