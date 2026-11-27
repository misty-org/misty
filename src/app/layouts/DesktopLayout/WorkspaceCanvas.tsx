import { PaneSwapMode } from "./PaneSwapMode";
import { routes } from "@/app/shell";
import type { TabSide } from "@/app/shell/docking_layout";
import {
  dockLeaves,
  findDockLeaf,
  startWorkspaceSides,
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
import { useClearTabsShortcut } from "./UseClearTabsShortcut";
import { AppBadgeSync } from "./attention";
import { WorkspaceTabPanels } from "./WorkspaceTabPanels";
import { TopEdge } from "./TopEdge";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { WorkspaceSearch } from "./search/WorkspaceSearch";
import { openChatRoute, openNewChat, openWorkspaceRoute } from "./space_navigation";
import { openAgentsPageEvent, SharedThreadsSync, TrayAgentsSync } from "@/features/agents";
import { openRouteEvent } from "@/shared/lib/open_route";
import { useAppPrograms, useAppStandby, useWindowSpace } from "@/features/spaces";
import type { WorkspaceTab } from "@/features/app-windows";
import { useWorkspaceCanvasShortcuts } from "./use_workspace_canvas_shortcuts";
import { useWorkspaceTabShortcuts } from "./use_workspace_tab_shortcuts";
import { disposeWorkspaceTab, workspaceTabsById } from "./workspace_view_lifecycle";
import { Surface } from "@misty/ui";
import { SidebarAccountBar } from "./SidebarAccountBar";
import { SidebarNowPlaying } from "./SidebarNowPlaying";

export function WorkspaceCanvas(props: {
  tabPosition?: TabSide;
  windowsTitlebarControls?: boolean;
  stripAccount?: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const layout = useWorkspaceStore((state) => state.layout);
  const asides = useWorkspaceStore((state) => state.asides);
  const away = useMemo(() => Object.values(asides ?? {}).map((aside) => aside.layout), [asides]);
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
    const route = tab?.route ?? (allLayoutViews(state.layout).length ? null : routes.newTab);
    if (route && `${location.pathname}${location.search}` !== route)
      navigate(route, { replace: true });
  }, [location.pathname, location.search, navigate]);

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

  useEffect(() => startWorkspaceSides(), []);

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

  const windowSpace = useWindowSpace();
  useAppPrograms();
  useAppStandby(windowSpace?.id);
  useEffect(() => {
    if (!windowSpace) return;
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string; app?: string }>).detail;
      const params = new URLSearchParams({ tab: detail?.tab ?? "agents" });
      if (detail?.app) params.set("app", detail.app);
      const route = `/spaces/${encodeURIComponent(windowSpace.id)}/explore?${params}`;
      openWorkspaceRoute(route, openTab);
    };
    window.addEventListener(openAgentsPageEvent, open);
    return () => window.removeEventListener(openAgentsPageEvent, open);
  }, [openTab, windowSpace]);

  useEffect(() => {
    const open = (event: Event) => {
      const route = (event as CustomEvent<{ route?: string }>).detail?.route;
      if (route?.startsWith("/")) openWorkspaceRoute(route, openTab);
    };
    window.addEventListener(openRouteEvent, open);
    return () => window.removeEventListener(openRouteEvent, open);
  }, [openTab]);

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
  const sidebarColumn = side === "right" ? 2 : 1;

  return (
    <>
      <Surface
        tone="chrome"
        className={`grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-clip ${
          side === "right" ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)]"
        }`}
        data-workspace-panes={leaves.length}
      >
        <SidebarDrawer
          side={side}
          gridColumn={sidebarColumn}
          footer={
            props.stripAccount ? (
              <SidebarAccountBar side={side} above={<SidebarNowPlaying onOpen={openTab} />}>
                {props.stripAccount}
              </SidebarAccountBar>
            ) : null
          }
        >
          <WorkspaceSidebar position={side} onOpen={openTab} />
        </SidebarDrawer>
        <TopEdge gridColumn={contentColumn} side={side} />
        <WorkspaceTabBar
          gridColumn={contentColumn}
          captionSlot={props.windowsTitlebarControls}
          onOpen={openTab}
          onClosed={navigateToActiveLayoutTab}
        />
        <WorkspaceTabPanels
          gridColumn={contentColumn}
          layout={layout}
          away={away}
          renderTree={dockTree}
        />
        <PaneSwapMode />
        <WorkspaceSearch onOpen={openTab} path={location.pathname} />
        <AppBadgeSync />
        <TrayAgentsSync
          onOpenChat={(agentId, chatId) =>
            openWorkspaceRoute(openChatRoute(agentId, chatId), openTab)
          }
          onNewChat={() => openNewChat(openTab)}
        />
        <SharedThreadsSync />
      </Surface>
    </>
  );
}
