import type { PluginCommandEntry } from "@/native/contracts";
import type { ExplorerCommandPaletteEntry } from "../model/interfaces/components/ExplorerToolbarModel";
import type { ExplorerSortColumn } from "../store";
export type {
  ExplorerCommandPaletteEntry,
  ExplorerLocationResult,
  ExplorerPaneToolbarActionsProps,
  ExplorerToolbarProps,
} from "../model/interfaces/components/ExplorerToolbarModel";

const explorerCommands: ExplorerCommandPaletteEntry[] = [
  {
    id: "app.toggle_transfers",
    label: "Open Transfers",
    hint: "Show transfer history and active work",
  },
  { id: "app.open_settings", label: "Open Settings", hint: "Switch to application settings" },
  { id: "app.toggle_plugin_launcher", label: "Open Extensions", hint: "Open Extensions" },
  {
    id: "clipboard.publish_shared",
    label: "Publish Shared Clipboard",
    hint: "Send the current clipboard to shared devices",
  },
  {
    id: "clipboard.apply_shared",
    label: "Apply Shared Clipboard",
    hint: "Copy the latest shared clipboard payload locally",
  },
  { id: "search.toggle", label: "Search", hint: "Focus Explorer search for the active folder" },
  { id: "explorer.new_tab", label: "New Tab", hint: "Open another tab for the active folder" },
  {
    id: "explorer.restore_tab",
    label: "Restore Closed Tab",
    hint: "Restore the most recently closed tab",
  },
  { id: "explorer.close_pane", label: "Close Pane", hint: "Close the active split pane or tab" },
  {
    id: "explorer.restore_pane",
    label: "Restore Pane",
    hint: "Restore the most recently closed pane",
  },
  {
    id: "explorer.split_vertical",
    label: "Split Vertically",
    hint: "Add a side-by-side pane for the active folder",
  },
  {
    id: "explorer.split_horizontal",
    label: "Split Horizontally",
    hint: "Add a stacked pane for the active folder",
  },
  { id: "explorer.refresh", label: "Refresh", hint: "Reload the active folder" },
  { id: "explorer.rename", label: "Rename", hint: "Rename the selected item" },
  {
    id: "explorer.batch_rename",
    label: "Batch Rename",
    hint: "Preview and queue renames for selected items",
  },
  {
    id: "explorer.duplicate_finder",
    label: "Find Duplicates",
    hint: "Scan folders and queue reviewed cleanup",
  },
  {
    id: "explorer.compare_with",
    label: "Compare With",
    hint: "Compare the selected file or folder against another path",
  },
  { id: "explorer.delete", label: "Delete", hint: "Delete the selected items" },
  {
    id: "explorer.download",
    label: "Download",
    hint: "Download selected remote items to Downloads",
  },
  { id: "explorer.open_with", label: "Open With", hint: "Choose an app for the selected file" },
  { id: "explorer.copy", label: "Copy", hint: "Copy selected items" },
  { id: "explorer.cut", label: "Cut", hint: "Move selected items with paste" },
  { id: "explorer.paste", label: "Paste", hint: "Paste into the active folder" },
  { id: "explorer.undo", label: "Undo", hint: "Undo the latest completed rename or move" },
  { id: "explorer.redo", label: "Redo", hint: "Redo the latest undone rename or move" },
  {
    id: "explorer.preview.toggle",
    label: "Toggle Preview",
    hint: "Show or hide the preview/details panel",
  },
  {
    id: "explorer.sidebar.toggle",
    label: "Toggle Sidebar",
    hint: "Show or hide the navigation sidebar",
  },
  {
    id: "explorer.next_workspace",
    label: "Next File Layout",
    hint: "Cycle to the next explorer tab",
  },
  ...Array.from({ length: 9 }, (_, index): ExplorerCommandPaletteEntry => ({
    id: `explorer.tab_${index + 1}`,
    label: `Select Tab ${index + 1}`,
    hint: `Switch to tab ${index + 1}`,
  })),
];

export const toolbarSortOptions: Array<{ column: ExplorerSortColumn; label: string }> = [
  { column: "name", label: "Name" },
  { column: "modified", label: "Modified" },
  { column: "size", label: "Size" },
  { column: "type", label: "Type" },
];

export function explorerCommandPaletteEntries(
  pluginCommands: PluginCommandEntry[],
): ExplorerCommandPaletteEntry[] {
  return [
    ...explorerCommands,
    ...pluginCommands.map((command) => ({
      id: command.id,
      label: command.label,
      hint: command.hint,
      group: "Extension" as const,
      pluginName: command.pluginName,
    })),
  ];
}

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
