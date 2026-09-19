export type ExplorerViewMode = "list" | "grid";
export type ExplorerCommandQueryMode = "search" | "filter";
export type ExplorerSortColumn = "name" | "modified" | "size" | "type";
export type ExplorerSortDirection = "asc" | "desc";
export interface ExplorerSortState {
  column: ExplorerSortColumn;
  direction: ExplorerSortDirection;
}
export interface ExplorerInlineEditState {
  paneId: string;
  kind: "create" | "rename";
  itemKind: "file" | "folder";
  entryId: string | null;
  originalName: string;
  value: string;
  lockedExtension: string;
  error: string | null;
  batchItems?: Array<{
    paneId: string;
    entryId: string;
    value: string;
    lockedExtension: string;
    error: string | null;
  }>;
}
