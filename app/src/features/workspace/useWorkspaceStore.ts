import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  BrowserTabState,
  OpenWorkspaceSurfaceRequest,
  WorkspaceGroupKey,
  WorkspaceLayout,
  WorkspaceLayoutPreset,
  WorkspacePane,
  WorkspaceSnapshot,
  WorkspaceTab,
} from "./model";
import {
  blankBrowserUrl,
  browserTabTitle,
  createBrowserTabState,
  parseBrowserTabState,
  workspaceMaxPanes,
} from "./model";

type SplitDirection = "right" | "down";

interface WorkspaceStore {
  layout: WorkspaceLayout;
  lastUsedTabByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  openSurface: (request: OpenWorkspaceSurfaceRequest) => WorkspaceTab;
  openBrowserTab: (request?: {
    url?: string;
    paneId?: string;
    sourceTabId?: string;
  }) => WorkspaceTab;
  updateBrowserTab: (tabId: string, patch: Partial<BrowserTabState> & { title?: string }) => void;
  renameTab: (tabId: string, title: string) => void;
  focusTab: (tabId: string) => boolean;
  closeTab: (tabId: string) => void;
  moveTab: (tabId: string, paneId: string, index?: number) => boolean;
  reorderTab: (paneId: string, tabId: string, index: number) => void;
  splitPane: (paneId: string, direction: SplitDirection, tabId?: string) => string | null;
  closePane: (paneId: string) => void;
  toggleSidebar: (tabId: string) => void;
  toggleMaximize: (paneId?: string) => void;
  restoreLayout: () => void;
  replaceSnapshot: (snapshot: WorkspaceSnapshot) => void;
  createSnapshot: (accountId: string, deviceId: string) => WorkspaceSnapshot;
  reset: () => void;
}

const initialPane = (): WorkspacePane => ({
  id: createId("pane"),
  tabs: [],
  activeTabId: null,
  size: 1,
});
const initialLayout = (): WorkspaceLayout => {
  const pane = initialPane();
  return {
    preset: "single",
    panes: [pane],
    focusedPaneId: pane.id,
    maximizedPaneId: null,
    preservedPreset: null,
  };
};

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      layout: initialLayout(),
      lastUsedTabByGroup: {},
      openSurface: (request) => {
        const now = Date.now();
        const state = get();
        const panes = state.layout.panes;
        const allTabs = panes.flatMap((pane) => pane.tabs);
        const singleton = request.instancePolicy === "single";
        const existing = singleton
          ? allTabs.find((tab) => tab.surfaceId === request.surfaceId)
          : !request.forceNew
            ? allTabs.find((tab) => tab.id === state.lastUsedTabByGroup[request.groupKey])
            : undefined;
        if (existing) {
          if (request.syncExistingRoute && existing.route !== request.route) {
            set((current) => ({
              layout: {
                ...current.layout,
                panes: current.layout.panes.map((pane) => ({
                  ...pane,
                  tabs: pane.tabs.map((tab) =>
                    tab.id === existing.id ? { ...tab, route: request.route } : tab,
                  ),
                })),
              },
            }));
          }
          get().focusTab(existing.id);
          return (
            get()
              .layout.panes.flatMap((pane) => pane.tabs)
              .find((tab) => tab.id === existing.id) ?? existing
          );
        }
        const pane =
          panes.find((candidate) => candidate.id === request.paneId) ??
          panes.find((candidate) => candidate.id === state.layout.focusedPaneId) ??
          panes[0];
        const tab: WorkspaceTab = {
          id: createId("tab"),
          surfaceId: request.surfaceId,
          groupKey: request.groupKey,
          instanceKey: request.instanceKey ?? createId(request.surfaceId),
          title: request.title,
          route: request.route,
          sidebarVisible: request.sidebarVisible ?? true,
          state: request.state ?? {},
          createdAt: now,
          lastFocusedAt: now,
        };
        set((current) => ({
          layout: {
            ...current.layout,
            focusedPaneId: pane.id,
            panes: current.layout.panes.map((candidate) =>
              candidate.id === pane.id
                ? { ...candidate, activeTabId: tab.id, tabs: [...candidate.tabs, tab] }
                : candidate,
            ),
          },
          lastUsedTabByGroup: { ...current.lastUsedTabByGroup, [tab.groupKey]: tab.id },
        }));
        return tab;
      },
      openBrowserTab: (request = {}) => {
        const url = request.url?.trim() || blankBrowserUrl;
        const tab = get().openSurface({
          surfaceId: "browser",
          groupKey: "tool:browser",
          title: browserTabTitle(url),
          route: "/browser",
          state: createBrowserTabState(url),
          instancePolicy: "multiple",
          forceNew: true,
          paneId: request.paneId,
        });
        if (request.sourceTabId) {
          const state = get();
          const pane = state.layout.panes.find((candidate) =>
            candidate.tabs.some((candidateTab) => candidateTab.id === request.sourceTabId),
          );
          const sourceIndex = pane?.tabs.findIndex(
            (candidate) => candidate.id === request.sourceTabId,
          );
          if (pane && sourceIndex !== undefined && sourceIndex >= 0) {
            state.moveTab(tab.id, pane.id, sourceIndex + 1);
          }
        }
        return tab;
      },
      updateBrowserTab: (tabId, patch) => {
        set((current) => ({
          layout: {
            ...current.layout,
            panes: current.layout.panes.map((pane) => ({
              ...pane,
              tabs: pane.tabs.map((tab) => {
                if (tab.id !== tabId || tab.surfaceId !== "browser") return tab;
                const { title, ...statePatch } = patch;
                const existing = parseBrowserTabState(tab.state);
                const urlDefaults =
                  statePatch.url && statePatch.url !== existing.url
                    ? createBrowserTabState(statePatch.url)
                    : existing;
                const state: BrowserTabState = { ...urlDefaults, ...statePatch };
                return {
                  ...tab,
                  title: title?.trim() || tab.title,
                  state,
                };
              }),
            })),
          },
        }));
      },
      renameTab: (tabId, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        const current = get();
        const currentTab = current.layout.panes
          .flatMap((pane) => pane.tabs)
          .find((tab) => tab.id === tabId);
        if (!currentTab || currentTab.title === trimmed) return;
        set({
          layout: {
            ...current.layout,
            panes: current.layout.panes.map((pane) => ({
              ...pane,
              tabs: pane.tabs.map((tab) =>
                tab.id === tabId ? { ...tab, title: trimmed } : tab,
              ),
            })),
          },
        });
      },
      focusTab: (tabId) => {
        const current = get();
        const pane = current.layout.panes.find((candidate) =>
          candidate.tabs.some((tab) => tab.id === tabId),
        );
        const tab = pane?.tabs.find((candidate) => candidate.id === tabId);
        if (!pane || !tab) return false;
        // No-op when the tab is already focused. WorkspaceCanvas fires
        // focusTab from a pane-level `onPointerDown`, which lands on every
        // click inside the pane — writing to the store on every click would
        // recreate `layout` and `lastUsedTabByGroup` and re-render every
        // workspace subscriber (tab bar, breadcrumbs, everything reading
        // `groups`), flashing the whole surface.
        const paneAlreadyFocused = current.layout.focusedPaneId === pane.id;
        const tabAlreadyActive = pane.activeTabId === tabId;
        if (paneAlreadyFocused && tabAlreadyActive) return true;
        const now = Date.now();
        set({
          layout: {
            ...current.layout,
            focusedPaneId: pane.id,
            panes: current.layout.panes.map((candidate) =>
              candidate.id === pane.id
                ? {
                    ...candidate,
                    activeTabId: tabId,
                    tabs: candidate.tabs.map((item) =>
                      item.id === tabId ? { ...item, lastFocusedAt: now } : item,
                    ),
                  }
                : candidate,
            ),
          },
          lastUsedTabByGroup: { ...current.lastUsedTabByGroup, [tab.groupKey]: tabId },
        });
        return true;
      },
      closeTab: (tabId) => {
        set((current) => {
          let group: WorkspaceGroupKey | undefined;
          const panes = current.layout.panes.map((pane) => {
            const index = pane.tabs.findIndex((tab) => tab.id === tabId);
            if (index < 0) return pane;
            group = pane.tabs[index]?.groupKey;
            const tabs = pane.tabs.filter((tab) => tab.id !== tabId);
            const activeTabId =
              pane.activeTabId === tabId
                ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
                : pane.activeTabId;
            return { ...pane, tabs, activeTabId };
          });
          const nonEmptyPanes = panes.filter((pane) => pane.tabs.length > 0);
          const nextPanes = nonEmptyPanes.length ? nonEmptyPanes : [initialPane()];
          const lastUsed = { ...current.lastUsedTabByGroup };
          if (group && lastUsed[group] === tabId) {
            const replacement = nextPanes
              .flatMap((pane) => pane.tabs)
              .filter((tab) => tab.groupKey === group)
              .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0];
            if (replacement) lastUsed[group] = replacement.id;
            else delete lastUsed[group];
          }
          return {
            layout: normalizeLayout({ ...current.layout, panes: nextPanes }),
            lastUsedTabByGroup: lastUsed,
          };
        });
      },
      moveTab: (tabId, paneId, index) => {
        const current = get();
        if (!current.layout.panes.some((pane) => pane.id === paneId)) return false;
        const sourcePane = current.layout.panes.find((pane) =>
          pane.tabs.some((tab) => tab.id === tabId),
        );
        const tab = sourcePane?.tabs.find((candidate) => candidate.id === tabId);
        if (!sourcePane || !tab) return false;
        set((state) => {
          const panes = state.layout.panes.map((pane) => {
            const without = pane.tabs.filter((candidate) => candidate.id !== tabId);
            if (pane.id !== paneId) {
              return {
                ...pane,
                tabs: without,
                activeTabId:
                  pane.activeTabId === tabId
                    ? (without[without.length - 1]?.id ?? null)
                    : pane.activeTabId,
              };
            }
            const at = Math.max(0, Math.min(index ?? without.length, without.length));
            const tabs = [...without.slice(0, at), tab, ...without.slice(at)];
            return { ...pane, tabs, activeTabId: tabId };
          });
          return { layout: normalizeLayout({ ...state.layout, focusedPaneId: paneId, panes }) };
        });
        return true;
      },
      reorderTab: (paneId, tabId, index) => {
        get().moveTab(tabId, paneId, index);
      },
      splitPane: (paneId, direction, tabId) => {
        const current = get();
        if (current.layout.panes.length >= workspaceMaxPanes) return null;
        const source = current.layout.panes.find((pane) => pane.id === paneId);
        if (!source) return null;
        const newPane = initialPane();
        const movingTabId = tabId ?? null;
        const movingTab = source.tabs.find((tab) => tab.id === movingTabId);
        if (movingTab) {
          newPane.tabs = [movingTab];
          newPane.activeTabId = movingTab.id;
        }
        set((state) => {
          const panes = state.layout.panes.map((pane) => {
            if (!movingTab || pane.id !== source.id) return pane;
            const tabs = pane.tabs.filter((tab) => tab.id !== movingTab.id);
            return { ...pane, tabs, activeTabId: tabs[tabs.length - 1]?.id ?? null };
          });
          const sourceIndex = panes.findIndex((pane) => pane.id === source.id);
          panes.splice(sourceIndex + 1, 0, newPane);
          return {
            layout: normalizeLayout({
              ...state.layout,
              focusedPaneId: newPane.id,
              panes,
              preset: layoutPresetForPaneCount(panes.length, direction),
            }),
          };
        });
        return newPane.id;
      },
      closePane: (paneId) => {
        set((current) => {
          if (current.layout.panes.length === 1) return current;
          const removed = current.layout.panes.find((pane) => pane.id === paneId);
          const panes = current.layout.panes.filter((pane) => pane.id !== paneId);
          if (removed?.tabs.length) {
            const target = panes[0];
            panes[0] = {
              ...target,
              tabs: [...target.tabs, ...removed.tabs],
              activeTabId: removed.activeTabId ?? target.activeTabId,
            };
          }
          return { layout: normalizeLayout({ ...current.layout, panes }) };
        });
      },
      toggleSidebar: (tabId) => {
        set((current) => ({
          layout: {
            ...current.layout,
            panes: current.layout.panes.map((pane) => ({
              ...pane,
              tabs: pane.tabs.map((tab) =>
                tab.id === tabId ? { ...tab, sidebarVisible: !tab.sidebarVisible } : tab,
              ),
            })),
          },
        }));
      },
      toggleMaximize: (paneId) => {
        const current = get();
        const target = paneId ?? current.layout.focusedPaneId;
        if (current.layout.maximizedPaneId) return void get().restoreLayout();
        if (!current.layout.panes.some((pane) => pane.id === target)) return;
        set({
          layout: {
            ...current.layout,
            maximizedPaneId: target,
            preservedPreset: current.layout.preset,
          },
        });
      },
      restoreLayout: () => {
        set((current) => ({
          layout: {
            ...current.layout,
            preset: current.layout.preservedPreset ?? current.layout.preset,
            maximizedPaneId: null,
            preservedPreset: null,
          },
        }));
      },
      replaceSnapshot: (snapshot) => {
        set({
          layout: normalizeLayout(migrateBrowserTabs(snapshot.layout)),
          lastUsedTabByGroup: snapshot.lastUsedTabByGroup ?? {},
        });
      },
      createSnapshot: (accountId, deviceId) => ({
        version: 1,
        accountId,
        deviceId,
        savedAt: Date.now(),
        layout: get().layout,
        lastUsedTabByGroup: get().lastUsedTabByGroup,
      }),
      reset: () => set({ layout: initialLayout(), lastUsedTabByGroup: {} }),
    }),
    {
      name: "misty:desktop-workspace:v1",
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<Pick<WorkspaceStore, "layout" | "lastUsedTabByGroup">>;
        return {
          layout: normalizeLayout(migrateBrowserTabs(state.layout ?? initialLayout())),
          lastUsedTabByGroup: state.lastUsedTabByGroup ?? {},
        };
      },
      partialize: (state) => ({
        layout: state.layout,
        lastUsedTabByGroup: state.lastUsedTabByGroup,
      }),
    },
  ),
);

function createId(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
}

function layoutPresetForPaneCount(count: number, direction: SplitDirection): WorkspaceLayoutPreset {
  if (count <= 1) return "single";
  if (count === 2) return direction === "down" ? "rows" : "columns";
  return "grid";
}

function normalizeLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const panes = layout.panes.slice(0, workspaceMaxPanes);
  const fallbackPane = panes[0] ?? initialPane();
  return {
    ...layout,
    panes: panes.length ? panes : [fallbackPane],
    focusedPaneId: panes.some((pane) => pane.id === layout.focusedPaneId)
      ? layout.focusedPaneId
      : fallbackPane.id,
    maximizedPaneId: panes.some((pane) => pane.id === layout.maximizedPaneId)
      ? layout.maximizedPaneId
      : null,
    preset: panes.length <= 1 ? "single" : layout.preset,
  };
}

function migrateBrowserTabs(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    ...layout,
    panes: layout.panes.map((pane) => ({
      ...pane,
      tabs: pane.tabs.map((tab) =>
        tab.surfaceId === "browser"
          ? {
              ...tab,
              title:
                tab.title && tab.title !== "Browser"
                  ? tab.title
                  : browserTabTitle(parseBrowserTabState(tab.state).url),
              state: parseBrowserTabState(tab.state),
            }
          : tab,
      ),
    })),
  };
}
