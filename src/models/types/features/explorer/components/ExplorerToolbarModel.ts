import type { PluginCommandEntry } from "@/models/interfaces/services/misty-api";
import type {
  ExplorerCommandQueryMode,
  ExplorerSortColumn,
  ExplorerSortState,
  ExplorerViewMode,
} from "@/stores/explorer";
import type { ExplorerSearchNavigationTarget } from "@/models/interfaces/features/explorer/utils/searchNavigation";

import type {
  ExplorerLocationResult,
  ExplorerCommandPaletteEntry,
  ExplorerToolbarProps,
  ExplorerPaneToolbarActionsProps,
} from "@/models/interfaces/features/explorer/components/ExplorerToolbarModel";

export type ExplorerCommandId =
  | "app.toggle_transfers"
  | "app.open_settings"
  | "app.toggle_plugin_launcher"
  | "clipboard.publish_shared"
  | "clipboard.apply_shared"
  | "search.toggle"
  | "explorer.new_tab"
  | "explorer.restore_tab"
  | "explorer.close_pane"
  | "explorer.restore_pane"
  | "explorer.split_vertical"
  | "explorer.split_horizontal"
  | "explorer.refresh"
  | "explorer.rename"
  | "explorer.batch_rename"
  | "explorer.duplicate_finder"
  | "explorer.compare_with"
  | "explorer.delete"
  | "explorer.download"
  | "explorer.open_with"
  | "explorer.copy"
  | "explorer.cut"
  | "explorer.paste"
  | "explorer.undo"
  | "explorer.redo"
  | "explorer.preview.toggle"
  | "explorer.sidebar.toggle"
  | "explorer.next_workspace"
  | "explorer.tab_1"
  | "explorer.tab_2"
  | "explorer.tab_3"
  | "explorer.tab_4"
  | "explorer.tab_5"
  | "explorer.tab_6"
  | "explorer.tab_7"
  | "explorer.tab_8"
  | "explorer.tab_9";
