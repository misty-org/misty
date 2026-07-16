import { create } from "zustand";
import {
  createClipboardActions,
  createMutationsActions,
  createNavigationActions,
  createSelectionActions,
  createShellActions,
  createWorkspaceActions,
} from "./explorer/actions";
import * as H from "./explorer/helpers";
import { registerExplorerStore } from "./explorer/runtime";
import type { ExplorerStore } from "./explorer/types";

export * from "./explorer/helpers";
export * from "./explorer/types";

export const useExplorerStore = create<ExplorerStore>((set, get) => ({
  panes: {},
  directorySizes: {},
  viewMode: "list",
  paneViewModes: {},
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
  chatOverlayOpen: false,
  mikaPanelOpen: false,
  mikaPanelWidth: 380,

  ...createWorkspaceActions(set, get),
  ...createNavigationActions(set, get),
  ...createSelectionActions(set, get),
  ...createMutationsActions(set, get),
  ...createClipboardActions(set, get),
  ...createShellActions(set, get),
} as ExplorerStore));

registerExplorerStore(useExplorerStore);
