import { create } from "zustand";
import {
  createClipboardActions,
  createMutationsActions,
  createNavigationActions,
  createSelectionActions,
  createShellActions,
  createWorkspaceActions,
} from "@/features/explorer/store/actions";
import * as H from "@/features/explorer/store/helpers";
import { registerExplorerStore } from "@/features/explorer/store/runtime";
import type { ExplorerStore } from "@/models/interfaces/features/explorer/store/types";

export * from "@/features/explorer/store/helpers";
export type * from "@/models/types/features/explorer/store/types";
export type * from "@/models/interfaces/features/explorer/store/types";

export const useExplorerStore = create<ExplorerStore>(
  (set, get) =>
    ({
      panes: {},
      directorySizes: {},
      viewMode: "list",
      paneViewModes: {},
      fileItemScale: 1,
      paneFileItemScales: {},
      showHidden: false,
      paneShowHidden: {},
      operationError: null,
      notifications: [],
      notificationHistory: [],
      clipboard: null,
      pinnedPaths: H.loadPinnedPaths(),
      contextMenu: { open: false, x: 0, y: 0, paneId: "", entryId: null },
      inlineEdit: null,
      dialog: null,
      library: null,
      workspaceEntries: [],
      activeWorkspaceId: "",
      activeWorkspaceTitle: "Workspace 1",
      initialized: false,
      sidebarVisible: true,
      previewVisible: true,
      sidebarWidth: 260,
      previewWidth: 300,
      sort: { column: "name", direction: "asc" },
      paneSorts: {},

      ...createWorkspaceActions(set, get),
      ...createNavigationActions(set, get),
      ...createSelectionActions(set, get),
      ...createMutationsActions(set, get),
      ...createClipboardActions(set, get),
      ...createShellActions(set, get),
    }) as ExplorerStore,
);

registerExplorerStore(useExplorerStore);
