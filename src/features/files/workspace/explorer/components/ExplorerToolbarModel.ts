import type { ExplorerSortColumn } from "../store";
export type { ExplorerLocationResult } from "../model/interfaces/components/ExplorerToolbarModel";

export const toolbarSortOptions: Array<{ column: ExplorerSortColumn; label: string }> = [
  { column: "name", label: "Name" },
  { column: "modified", label: "Modified" },
  { column: "size", label: "Size" },
  { column: "type", label: "Type" },
];
