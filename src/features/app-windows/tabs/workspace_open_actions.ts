import {
  activeLayoutView,
  allLayoutViews,
  appendTab,
  mapLayoutViews,
  singleViewTab,
} from "../panes/layout_tabs";
import { createDockId, dockLeaves, findDockLeaf, mapDockLeaf } from "../panes/dock_tree";
import type { WorkspaceView } from "./workspace_views";
import {
  compareViewRecency,
  lastUsedUpdatesForView,
  nextWorkspaceFocusTimestamp,
} from "./workspace_view_operations";
import { createDefaultWorkspaceView } from "./workspace_default_view";
import type { StoreApi } from "zustand";
import type { WorkspaceStore } from "./use_workspace_store";
import { withLayout } from "./workspace_layout_update";

export function workspaceOpenActions(
  set: StoreApi<WorkspaceStore>["setState"],
  get: () => WorkspaceStore,
): Pick<
  WorkspaceStore,
  "openSurface" | "openDestination" | "commitPlaceholder" | "addSurface" | "newTab"
> {
  return {
    openSurface: (request) => {
      const current = get();
      const pane =
        findDockLeaf(current.layout.root, request.paneId ?? current.layout.focusedPaneId) ??
        dockLeaves(current.layout.root)[0];
      const previous = pane.views[0];
      const replacePane =
        Boolean(previous?.placeholder || previous?.fresh) &&
        (!request.forceNew || Boolean(request.paneId));
      const existing =
        !replacePane && !request.forceNew
          ? allLayoutViews(current.layout)
              .filter((tab) => !tab.placeholder && tab.groupKey === request.groupKey)
              .sort(
                (a, b) =>
                  Number(b.route === request.route) - Number(a.route === request.route) ||
                  compareViewRecency(a, b),
              )[0]
          : undefined;
      if (existing) {
        get().focusView(existing.id);
        if (request.syncExistingRoute && existing.route !== request.route)
          get().updateViewRoute(existing.id, request.route);
        return allLayoutViews(get().layout).find((tab) => tab.id === existing.id)!;
      }
      const now = nextWorkspaceFocusTimestamp(current.layout);
      const tab: WorkspaceView = {
        id: createDockId("tab"),
        surfaceId: request.surfaceId,
        groupKey: request.groupKey,
        instanceKey: createDockId("tab"),
        title: request.title,
        route: request.route,
        sidebarVisible: request.sidebarVisible ?? true,
        state: request.state ?? {},
        createdAt: now,
        lastFocusedAt: now,
      };
      const layout = replacePane
        ? {
            ...current.layout,
            focusedPaneId: pane.id,
            root: mapDockLeaf(current.layout.root, pane.id, (leaf) => ({
              ...leaf,
              views: [tab],
              activeViewId: tab.id,
              history: undefined,
            })),
          }
        : appendTab(current.layout, singleViewTab(tab));
      set({
        ...withLayout(current, layout),
        lastUsedViewByGroup: {
          ...current.lastUsedViewByGroup,
          ...lastUsedUpdatesForView(tab, tab.id),
        },
      });
      return tab;
    },
    openDestination: (request) => {
      const current = get();
      const active = activeLayoutView(current.layout);
      if (!active?.placeholder && !active?.fresh) {
        const spaceId = request.surfaceId === "space" ? request.groupKey.split(":")[1] : null;
        const existing = allLayoutViews(current.layout)
          .filter(
            (tab) =>
              !tab.placeholder &&
              (request.groupKey.startsWith("app:")
                ? tab.groupKey === request.groupKey
                : spaceId
                  ? tab.surfaceId === "space" && tab.groupKey.split(":")[1] === spaceId
                  : tab.groupKey === request.groupKey),
          )
          .sort(compareViewRecency)[0];
        if (existing) {
          get().focusView(existing.id);
          return existing;
        }
      }
      return get().openSurface({ ...request, syncExistingRoute: false });
    },
    commitPlaceholder: (tabId) => {
      if (
        !allLayoutViews(get().layout).some(
          (tab) => tab.id === tabId && (tab.placeholder || tab.fresh),
        )
      )
        return;
      set((current) => ({
        layout: mapLayoutViews(current.layout, (tab) =>
          tab.id === tabId ? { ...tab, placeholder: false, fresh: false } : tab,
        ),
      }));
    },
    addSurface: (request) => get().openSurface({ ...request, forceNew: true }),
    newTab: (route) => {
      const current = get(),
        idle = createDefaultWorkspaceView(),
        view = route ? { ...idle, route, placeholder: false, fresh: true } : idle;
      set(withLayout(current, appendTab(current.layout, singleViewTab(view))));
      return view;
    },
  };
}
