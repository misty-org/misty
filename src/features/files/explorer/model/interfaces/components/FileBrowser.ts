import type { DirectoryListing, DirectorySizeRecord, FileEntry } from "@/native/contracts";
import type { MouseEvent } from "react";
import type {
  ExplorerCommandQueryMode,
  ExplorerInlineEditState,
  ExplorerSortColumn,
  ExplorerSortState,
  ExplorerViewMode,
} from "../../../store";
import type { ExplorerDragModifiers, ExplorerDragPayload } from "../drag/types";

import type { GridThumbnailSubscriber } from "../../types/components/FileBrowser";

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

export interface GridThumbnailJob {
  key: string;
  entry: FileEntry;
  maxDimension: number;
  subscribers: Set<GridThumbnailSubscriber>;
  processing: boolean;
  background: boolean;
}
