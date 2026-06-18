import { create } from "zustand";
import { explorerListDirectory } from "../../../api/misty";
import type { DirectoryListing, FileEntry } from "../../../api/types";
import { errorText } from "../../../shared/format";
import { useMultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";

export type ExplorerViewMode = "list" | "grid";

interface PaneExplorerState {
  listing: DirectoryListing | null;
  selectedIds: string[];
  loading: boolean;
  error: string | null;
}

interface ExplorerStore {
  panes: Record<string, PaneExplorerState>;
  viewMode: ExplorerViewMode;
  showHidden: boolean;
  commandQuery: string;
  initialize: (homePath: string) => Promise<void>;
  loadPane: (paneId: string, path: string) => Promise<void>;
  navigatePane: (paneId: string, path: string) => Promise<void>;
  navigateParent: (paneId: string) => Promise<void>;
  refreshPane: (paneId: string) => Promise<void>;
  setViewMode: (mode: ExplorerViewMode) => void;
  setCommandQuery: (query: string) => void;
  toggleHidden: () => Promise<void>;
  selectEntry: (paneId: string, entryId: string) => void;
  openEntry: (paneId: string, entry: FileEntry) => Promise<void>;
}

const emptyPaneState: PaneExplorerState = {
  listing: null,
  selectedIds: [],
  loading: false,
  error: null,
};

export const useExplorerStore = create<ExplorerStore>((set, get) => ({
  panes: {},
  viewMode: "list",
  showHidden: false,
  commandQuery: "",

  initialize: async (homePath) => {
    const multi = useMultiPanelStore.getState();
    multi.initialize(homePath, titleFromPath(homePath));
    await get().loadPane(multi.activePaneId || "explorer-pane-0", homePath);
  },

  loadPane: async (paneId, path) => {
    set((state) => ({
      panes: {
        ...state.panes,
        [paneId]: { ...(state.panes[paneId] ?? emptyPaneState), loading: true, error: null },
      },
    }));
    try {
      const listing = await explorerListDirectory({ path, showHidden: get().showHidden });
      useMultiPanelStore.getState().updateActiveTabPath(paneId, listing.path, titleFromPath(listing.path));
      set((state) => ({
        panes: {
          ...state.panes,
          [paneId]: {
            listing,
            selectedIds: [],
            loading: false,
            error: null,
          },
        },
      }));
    } catch (error) {
      set((state) => ({
        panes: {
          ...state.panes,
          [paneId]: { ...(state.panes[paneId] ?? emptyPaneState), loading: false, error: errorText(error) },
        },
      }));
    }
  },

  navigatePane: async (paneId, path) => {
    await get().loadPane(paneId, path);
  },

  navigateParent: async (paneId) => {
    const parent = get().panes[paneId]?.listing?.parentPath;
    if (parent) {
      await get().loadPane(paneId, parent);
    }
  },

  refreshPane: async (paneId) => {
    const path = get().panes[paneId]?.listing?.path;
    if (path) {
      await get().loadPane(paneId, path);
    }
  },

  setViewMode: (viewMode) => set({ viewMode }),
  setCommandQuery: (commandQuery) => set({ commandQuery }),

  toggleHidden: async () => {
    const showHidden = !get().showHidden;
    set({ showHidden });
    const paneEntries = Object.entries(get().panes);
    await Promise.all(
      paneEntries.map(([paneId, pane]) => (pane.listing ? get().loadPane(paneId, pane.listing.path) : Promise.resolve())),
    );
  },

  selectEntry: (paneId, entryId) => {
    set((state) => {
      const pane = state.panes[paneId] ?? emptyPaneState;
      return {
        panes: {
          ...state.panes,
          [paneId]: { ...pane, selectedIds: [entryId] },
        },
      };
    });
  },

  openEntry: async (paneId, entry) => {
    if (entry.kind === "folder" || entry.kind === "symlink") {
      await get().loadPane(paneId, entry.path);
      return;
    }
    get().selectEntry(paneId, entry.id);
  },
}));

export function selectedEntryForPane(pane: PaneExplorerState | undefined): FileEntry | null {
  if (!pane?.listing || pane.selectedIds.length === 0) return null;
  return pane.listing.entries.find((entry) => entry.id === pane.selectedIds[0]) ?? null;
}

function titleFromPath(path: string): string {
  const clean = path.replace(/\/+$/, "");
  return clean.split("/").filter(Boolean).pop() || clean || "Home";
}
