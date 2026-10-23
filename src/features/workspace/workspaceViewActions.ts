import { pushPaneView } from "./paneHistory";
import { layoutTabs, activateTab } from "./layoutTabs";
import { mapDockLeafForView } from "./dockTree";
import type { BrowserViewState } from "./model";
import { mapAllWorkspaceWindowViews, mapAllWorkspaceWindowLayouts } from "./windows";
import {
  browserViewTitle,
  createBrowserViewState,
  parseBrowserViewState,
  sanitizeBrowserTitle,
} from "./model";
import type { StoreApi } from "zustand";
import type { WorkspaceStore } from "./useWorkspaceStore";

/** Changes to one view's title, route, state or sidebar. */
export function workspaceViewActions(
  set: StoreApi<WorkspaceStore>["setState"],
  get: () => WorkspaceStore,
): Pick<
  WorkspaceStore,
  "updateBrowserView" | "renameView" | "updateViewRoute" | "updateViewState" | "toggleSidebar"
> {
  return {
    updateBrowserView: (tabId, patch) => {
      set((current) =>
        mapAllWorkspaceWindowViews(current, (tab) => {
          if (tab.id !== tabId || tab.surfaceId !== "browser") return tab;
          const { title, ...statePatch } = patch;
          const existing = parseBrowserViewState(tab.state);
          const nextUrl = statePatch.url ?? existing.url;
          const defaults =
            statePatch.url && statePatch.url !== existing.url
              ? { ...existing, ...createBrowserViewState(statePatch.url) }
              : existing;
          const resolvedTitle =
            title !== undefined
              ? sanitizeBrowserTitle(title, nextUrl)
              : statePatch.url && statePatch.url !== existing.url
                ? browserViewTitle(statePatch.url)
                : tab.title;
          return {
            ...tab,
            placeholder: nextUrl !== existing.url ? false : tab.placeholder,
            title: resolvedTitle,
            state: { ...defaults, ...statePatch } satisfies BrowserViewState,
          };
        }),
      );
    },
    renameView: (tabId, title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      set((current) =>
        mapAllWorkspaceWindowViews(current, (tab) =>
          tab.id === tabId && tab.title !== trimmed ? { ...tab, title: trimmed } : tab,
        ),
      );
    },
    updateViewRoute: (tabId, route, replace = false) => {
      set(
        mapAllWorkspaceWindowLayouts(get(), (layout) => {
          const tabs = layoutTabs(layout).map((tab) => ({
            ...tab,
            root: mapDockLeafForView(tab.root, tabId, (pane) => {
              const view = pane.views[0];
              return view.route === route
                ? pane
                : pushPaneView(pane, { ...view, route, placeholder: false }, replace);
            }),
          }));
          return activateTab({ ...layout, tabs }, layout.activeTabId ?? tabs[0].id);
        }),
      );
    },
    updateViewState: (tabId, state, title) => {
      set((current) =>
        mapAllWorkspaceWindowViews(current, (tab) =>
          tab.id === tabId ? { ...tab, state, title: title?.trim() || tab.title } : tab,
        ),
      );
    },
    toggleSidebar: (tabId) => {
      set((current) =>
        mapAllWorkspaceWindowViews(current, (tab) =>
          tab.id === tabId ? { ...tab, sidebarVisible: !tab.sidebarVisible } : tab,
        ),
      );
    },
  };
}
