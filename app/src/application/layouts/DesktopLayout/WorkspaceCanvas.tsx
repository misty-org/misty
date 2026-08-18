import { closeBrowserRuntime } from "@/features/browser";
import { killTerminalTab } from "@/features/terminal";
import {
  dockLeaves,
  dockWidgetRegistry,
  findDockLeaf,
  shouldReturnWorkspaceHome,
  useWorkspaceStore,
  type WorkspaceGroupKey,
  type WorkspaceTab,
} from "@/features/workspace";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { WorkspaceDockTree } from "./WorkspaceDockTree";
import type { NewTabOption } from "./WorkspaceNewTabMenu";

export function WorkspaceCanvas(props: { outlet: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const layout = useWorkspaceStore((state) => state.layout);
  const lastUsedTabByGroup = useWorkspaceStore((state) => state.lastUsedTabByGroup);
  const focusTab = useWorkspaceStore((state) => state.focusTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const openBrowserTab = useWorkspaceStore((state) => state.openBrowserTab);
  const openSurface = useWorkspaceStore((state) => state.openSurface);
  const splitPane = useWorkspaceStore((state) => state.splitPane);
  const moveTab = useWorkspaceStore((state) => state.moveTab);
  const dockTab = useWorkspaceStore((state) => state.dockTab);
  const closePane = useWorkspaceStore((state) => state.closePane);
  const fillEmptyPanes = useWorkspaceStore((state) => state.fillEmptyPanes);
  const updateSplitRatio = useWorkspaceStore((state) => state.updateSplitRatio);
  const leaves = useMemo(() => dockLeaves(layout.root), [layout.root]);
  const tabCount = useMemo(
    () => leaves.reduce((count, pane) => count + pane.tabs.length, 0),
    [leaves],
  );
  const previousTabCountRef = useRef(tabCount);

  useEffect(() => fillEmptyPanes(), [fillEmptyPanes, layout.root]);

  const openTab = useCallback(
    (tab: WorkspaceTab) => {
      focusTab(tab.id);
      if (`${location.pathname}${location.search}` !== tab.route) navigate(tab.route);
    },
    [focusTab, location.pathname, location.search, navigate],
  );

  const closeWorkspaceTab = useCallback(
    (tab: WorkspaceTab) => {
      if (tab.surfaceId === "browser") void closeBrowserRuntime(tab);
      if (tab.surfaceId === "terminal") killTerminalTab(tab.id);
      dockWidgetRegistry.get(tab.surfaceId).dispose?.(tab.state);
      closeTab(tab.id);
    },
    [closeTab],
  );

  const openNewTab = useCallback(
    (option: NewTabOption, paneId: string) => {
      if (option.surfaceId === "browser") return openTab(openBrowserTab({ paneId }));
      openTab(
        openSurface({
          surfaceId: option.surfaceId,
          groupKey: `tool:${option.surfaceId}` as WorkspaceGroupKey,
          title: option.label,
          route: option.route,
          instancePolicy: option.instancePolicy ?? "multiple",
          forceNew: option.instancePolicy !== "single",
          paneId,
          state: dockWidgetRegistry.get(option.surfaceId).create(),
        }),
      );
    },
    [openBrowserTab, openSurface, openTab],
  );

  useEffect(() => {
    const previousTabCount = previousTabCountRef.current;
    previousTabCountRef.current = tabCount;
    if (shouldReturnWorkspaceHome(previousTabCount, tabCount, location.pathname)) {
      navigate("/home", { replace: true });
    }
  }, [location.pathname, navigate, tabCount]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== "w"
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const state = useWorkspaceStore.getState();
      const focused = findDockLeaf(state.layout.root, state.layout.focusedPaneId);
      const active = focused?.tabs.find((tab) => tab.id === focused.activeTabId);
      if (active) closeWorkspaceTab(active);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [closeWorkspaceTab]);

  if (!tabCount && location.pathname === "/home") {
    return <div className="h-full min-h-0 overflow-hidden bg-charcoal-bg">{props.outlet}</div>;
  }

  return (
    <div
      className="h-full min-h-0 overflow-hidden bg-charcoal-border"
      data-workspace-panes={leaves.length}
    >
      <WorkspaceDockTree
        node={layout.root}
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
        onResizeSplit={updateSplitRatio}
      />
    </div>
  );
}
