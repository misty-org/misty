import { activeLayoutView, allLayoutViews, appendTab, singleViewTab } from "./layoutTabs";
import { createDockId, dockLeaves, findDockLeaf, mapDockLeaf } from "./dockTree";
import type { WorkspaceView } from "./model";
import { mapAllWorkspaceWindowViews } from "./windows";
import { isIncognitoWindow, windowSpaceScope } from "./spaceWindow";
import {
  compareViewRecency,
  lastUsedUpdatesForView,
  nextWorkspaceFocusTimestamp,
} from "./workspaceViewOperations";
import { browserNewTabUrl } from "./browserHome";
import { browserViewTitle, createBrowserViewState } from "./model";
import { createBlankWorkspaceView } from "./workspaceDefaultView";
import type { StoreApi } from "zustand";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { withLayout } from "./workspaceLayoutUpdate";

/** Opening tools, destinations and browser pages as views. */
export function workspaceOpenActions(
  set: StoreApi<WorkspaceStore>["setState"],
  get: () => WorkspaceStore,
): Pick<
  WorkspaceStore,
  | "openSurface"
  | "openDestination"
  | "commitPlaceholder"
  | "addSurface"
  | "newTab"
  | "openBrowserView"
> {
  return {
    openSurface: (request) => {
      if (request.scopeKey) get().setScope(request.scopeKey);
      else if (request.surfaceId === "space") get().setScope(windowSpaceScope());
      const current = get();
      const pane =
        findDockLeaf(current.layout.root, request.paneId ?? current.layout.focusedPaneId) ??
        dockLeaves(current.layout.root)[0];
      const previous = pane.views[0];
      const replacePane =
        Boolean(previous?.placeholder) && (!request.forceNew || Boolean(request.paneId));
      const existing =
        !replacePane && !request.forceNew
          ? allLayoutViews(current.layout)
              .filter((tab) => !tab.placeholder && tab.groupKey === request.groupKey)
              // Prefer the tab already showing this route so a close or a URL
              // change never re-targets a sibling in the same group.
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
      const now = nextWorkspaceFocusTimestamp(current.layoutsByScope);
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
      if (request.scopeKey) get().setScope(request.scopeKey);
      const current = get();
      // An explicit new tab/split is an invitation to create another instance.
      if (!activeLayoutView(current.layout)?.placeholder) {
        const spaceId = request.surfaceId === "space" ? request.groupKey.split(":")[1] : null;
        const existing = allLayoutViews(current.layout)
          .filter(
            (tab) =>
              !tab.placeholder &&
              (spaceId
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
      if (!allLayoutViews(get().layout).some((tab) => tab.id === tabId && tab.placeholder)) return;
      set((current) =>
        mapAllWorkspaceWindowViews(current, (tab) =>
          tab.id === tabId ? { ...tab, placeholder: false } : tab,
        ),
      );
    },
    addSurface: (request) => get().openSurface({ ...request, forceNew: true }),
    newTab: () => {
      const current = get(),
        view = createBlankWorkspaceView(current.activeScopeKey);
      set(withLayout(current, appendTab(current.layout, singleViewTab(view))));
      return view;
    },
    openBrowserView: (request = {}) => {
      const url = request.url?.trim() || browserNewTabUrl(isIncognitoWindow());
      const tab = get().openSurface({
        surfaceId: "browser",
        groupKey: "tool:browser",
        scopeKey: windowSpaceScope(),
        title: browserViewTitle(url),
        route: "/browser",
        state: {
          ...createBrowserViewState(url),
          bookmarkId: request.bookmarkId,
        },
        instancePolicy: "multiple",
        forceNew: true,
        paneId: request.paneId,
      });
      get().focusView(tab.id);
      return tab;
    },
  };
}
