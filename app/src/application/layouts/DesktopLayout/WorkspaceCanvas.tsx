import { closeBrowserRuntime } from "@/features/browser";
import { killTerminalTab } from "@/features/terminal";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  dockLeaves,
  dockWidgetRegistry,
  findDockLeaf,
  parseCodeTabState,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type WorkspaceGroupKey,
  type WorkspaceTab,
} from "@/features/workspace";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { closeTabMenuEvent } from "./appMenuEvents";
import { WorkspaceDockTree } from "./WorkspaceDockTree";
import type { NewTabOption } from "./WorkspaceNewTabMenu";

export function WorkspaceCanvas(props: {
  outlet: ReactNode;
  titlebarInsets?: { left: number; right: number };
}) {
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
  const updateSplitRatio = useWorkspaceStore((state) => state.updateSplitRatio);
  const leaves = useMemo(() => dockLeaves(layout.root), [layout.root]);

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
      if (option.surfaceId === "browser") return openTab(openBrowserTab({ paneId }));
      if (option.surfaceId === "space") {
        const surfaceReq = workspaceSurfaceFromRoute(option.route);
        if (surfaceReq) {
          openTab(
            openSurface({
              ...surfaceReq,
              forceNew: true,
              paneId,
              state: dockWidgetRegistry.get("space").create(),
            }),
          );
          return;
        }
      }
      if (option.surfaceId === "code") {
        const state = useWorkspaceStore.getState();
        const focusedPane = findDockLeaf(state.layout.root, state.layout.focusedPaneId);
        const currentCode = focusedPane?.tabs.find(
          (tab) => tab.id === focusedPane.activeTabId && tab.surfaceId === "code",
        );
        const currentState = parseCodeTabState(currentCode?.state);
        return openTab(
          openSurface({
            surfaceId: "code",
            groupKey: "tool:code",
            title: "Code",
            route: option.route,
            instancePolicy: "multiple",
            forceNew: true,
            paneId,
            state: {
              ...currentState,
              activeFilePath: null,
            },
          }),
        );
      }
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

  const closeActiveTab = useCallback(() => {
    const state = useWorkspaceStore.getState();
    const focused = findDockLeaf(state.layout.root, state.layout.focusedPaneId);
    const active = focused?.tabs.find((tab) => tab.id === focused.activeTabId);
    if (active) closeWorkspaceTab(active);
  }, [closeWorkspaceTab]);

  // macOS routes Cmd+W through the app menu, which fires even while a native
  // browser tab holds focus and this web view never sees the key at all.
  useEffect(() => {
    if (!hasTauriInternals()) return;
    const stop = listen(closeTabMenuEvent, () => closeActiveTab());
    return () => void stop.then((unlisten) => unlisten());
  }, [closeActiveTab]);

  // Platforms without that menu still need the raw shortcut.
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
      closeActiveTab();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [closeActiveTab]);

  return (
    <div
      className="h-full min-h-0 overflow-hidden bg-charcoal-border"
      data-workspace-panes={leaves.length}
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
        onResizeSplit={updateSplitRatio}
      />
    </div>
  );
}
