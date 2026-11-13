import { pushPaneView } from "../panes/paneHistory";
import { layoutTabs, activateTab, mapLayoutViews } from "../panes/layoutTabs";
import { mapDockLeafForView } from "../panes/dockTree";
import type { StoreApi } from "zustand";
import type { WorkspaceStore } from "./useWorkspaceStore";

/** Changes to one view's title, route, state or sidebar. */
export function workspaceViewActions(
  set: StoreApi<WorkspaceStore>["setState"],
  get: () => WorkspaceStore,
): Pick<WorkspaceStore, "renameView" | "updateViewRoute" | "updateViewState" | "toggleSidebar"> {
  return {
    renameView: (tabId, title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      set((current) => ({
        layout: mapLayoutViews(current.layout, (tab) =>
          tab.id === tabId && tab.title !== trimmed ? { ...tab, title: trimmed } : tab,
        ),
      }));
    },
    updateViewRoute: (tabId, route, replace = false) => {
      const { layout } = get();
      const tabs = layoutTabs(layout).map((tab) => ({
        ...tab,
        root: mapDockLeafForView(tab.root, tabId, (pane) => {
          const view = pane.views[0];
          return view.route === route
            ? pane
            : pushPaneView(pane, { ...view, route, placeholder: false }, replace);
        }),
      }));
      set({ layout: activateTab({ ...layout, tabs }, layout.activeTabId ?? tabs[0].id) });
    },
    updateViewState: (tabId, state, title) => {
      set((current) => ({
        layout: mapLayoutViews(current.layout, (tab) =>
          tab.id === tabId ? { ...tab, state, title: title?.trim() || tab.title } : tab,
        ),
      }));
    },
    toggleSidebar: (tabId) => {
      set((current) => ({
        layout: mapLayoutViews(current.layout, (tab) =>
          tab.id === tabId ? { ...tab, sidebarVisible: !tab.sidebarVisible } : tab,
        ),
      }));
    },
  };
}
