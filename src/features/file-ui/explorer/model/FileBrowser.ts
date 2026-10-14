import type { DirectoryListing, DirectorySizeRecord, FileEntry } from "@/native/ipc";
import type { MouseEvent } from "react";
import type {
  ExplorerCommandQueryMode,
  ExplorerInlineEditState,
  ExplorerSortColumn,
  ExplorerSortState,
  ExplorerViewMode,
} from "../store/index";
import type { ExplorerDragItem, ExplorerDragModifiers, ExplorerDragPayload } from "./drag";

export interface FileBrowserProps {
  paneId: string;
  selectionOnly?: boolean;
  listing: DirectoryListing | null;
  selectedIds: string[];
  loading: boolean;
  error: string | null;
  viewMode: ExplorerViewMode;
  itemScale?: number;
  sort: ExplorerSortState;
  showHidden: boolean;
  commandQuery: string;
  commandQueryMode: ExplorerCommandQueryMode;
  directorySizes: Record<string, DirectorySizeRecord>;
  cutPaths: ReadonlySet<string>;
  inlineEdit: ExplorerInlineEditState | null;
  onSort: (column: ExplorerSortColumn) => void;
  onToggleHidden: () => void;
  onSelect: (entryId: string, event: MouseEvent, visibleEntryIds: string[]) => void;
  onClearSelection: () => void;
  onOpen: (entry: FileEntry) => void;
  onContextMenu: (event: MouseEvent, entry: FileEntry) => void;
  onBackgroundContextMenu: (event: MouseEvent) => void;
  onDropItems: (
    payload: ExplorerDragPayload,
    destination: string,
    destinationStorageId: string,
    modifiers: ExplorerDragModifiers,
  ) => void;
  onInlineEditChange: (value: string) => void;
  onInlineEditCommit: () => void;
  onInlineEditCancel: () => void;
}

export type FileTableColumn = ExplorerSortColumn;

export type FileTableColumnWidths = Record<FileTableColumn, number>;

export type GridThumbnailSubscriber = (url: string | null) => void;

export type FileBrowserDragItem = ExplorerDragItem;

export type PassiveRenameDraft = {
  value: string;
  lockedExtension: string;
  error: string | null;
};
