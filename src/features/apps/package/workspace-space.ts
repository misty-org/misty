export { MistyBrandIcon } from "@/features/workspace/MistyBrandIcon";
export * from "@/features/workspace/model";
export {
  createDockLeaf,
  dockLeaves,
  dockTabs,
  findDockLeaf,
  mapDockTabs,
} from "@/features/workspace/dockTree";
import { createDockLeaf, dockTabs, mapDockTabs } from "@/features/workspace/dockTree";
import { useEffect } from "react";
import { create } from "zustand";
export type {
  MultiPanelClosedPane,
  MultiPanelPane,
  MultiPanelTab,
} from "@/features/workspace/model/interfaces/types";
export {
  activeMultiPanelTab,
  createMultiPanelStore,
  destroyMultiPanelStore,
  maxMultiPanelPanes,
  multiPanelStoreForPane,
  useMultiPanelStore,
} from "@/features/workspace/useMultiPanelStore";

export const useWorkspaceStore = create<any>((set: (update: any) => void, get: () => any) => ({
  layout: { root: createDockLeaf(), focusedPaneId: "" },
  updateTabState: (tabId: string, state: unknown, title?: string) =>
    set((current: any) => ({
      layout: {
        ...current.layout,
        root: mapDockTabs(current.layout.root, (tab) =>
          tab.id === tabId ? { ...tab, state, title: title?.trim() || tab.title } : tab,
        ),
      },
    })),
  updateTabRoute: (tabId: string, route: string) =>
    set((current: any) => ({
      layout: {
        ...current.layout,
        root: mapDockTabs(current.layout.root, (tab) =>
          tab.id === tabId ? { ...tab, route } : tab,
        ),
      },
    })),
  renameTab: (tabId: string, title: string) => {
    const tab = dockTabs(get().layout.root).find((candidate) => candidate.id === tabId);
    if (tab) get().updateTabState(tabId, tab.state, title);
  },
  focusTab: (tabId: string) =>
    dockTabs(get().layout.root).some((candidate) => candidate.id === tabId),
  open: () => undefined,
  close: () => undefined,
  setLayout: (layout: unknown) => set({ layout }),
}));

export const useRecentToolsStore = {
  getState: () => ({ recordToolUsage: (_toolId: string) => undefined }),
};
export type {
  MultiPanelStore,
  MultiPanelStoreHook,
  MultiPanelStoreOptions,
} from "@/features/workspace/useMultiPanelStore";

export function useWorkspaceTabTitle(tabId: string | undefined, title: string): void {
  useEffect(() => {
    if (!tabId || !title.trim()) return;
    const workspace = useWorkspaceStore.getState();
    const tab = dockTabs(workspace.layout.root).find((candidate) => candidate.id === tabId);
    if (tab && tab.title !== title.trim()) {
      workspace.updateTabState(tabId, tab.state, title);
    }
  }, [tabId, title]);
}

export function useWorkspaceTabFocused(): boolean {
  return true;
}

export function workspaceSurfaceFromRoute(): null {
  return null;
}
