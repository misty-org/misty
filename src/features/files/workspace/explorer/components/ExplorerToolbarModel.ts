import type { ExplorerSortColumn } from "../store";
export type {
  ExplorerLocationResult,
  ExplorerPaneToolbarActionsProps,
  ExplorerToolbarProps,
} from "../model/interfaces/components/ExplorerToolbarModel";

export const toolbarSortOptions: Array<{ column: ExplorerSortColumn; label: string }> = [
  { column: "name", label: "Name" },
  { column: "modified", label: "Modified" },
  { column: "size", label: "Size" },
  { column: "type", label: "Type" },
];

export type ExplorerCommandId =
  | "app.toggle_transfers"
  | "app.open_settings"
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
