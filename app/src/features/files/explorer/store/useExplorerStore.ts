import { create } from "zustand";
import type { ExplorerStore } from "../model/interfaces/store/types";
import {
  createClipboardActions,
  createMutationsActions,
  createNavigationActions,
  createSelectionActions,
  createShellActions,
  createWorkspaceActions,
} from "./actions";
import * as H from "./helpers";
import { registerExplorerStore } from "./runtime";

export type * from "../model/interfaces/store/types";
export type * from "../model/types/store/types";
export * from "./helpers";

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
      activeWorkspaceTitle: "Profile 1",
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
