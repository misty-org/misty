import { Button } from "@/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { explorerGenerateImageThumbnail } from "@/stores/backend";
import type {
  DirectoryListing,
  DirectorySizeRecord,
  FileEntry,
} from "@/models/interfaces/services/misty-api";
import { safeTauriAssetUrl } from "@/platform/tauri";
import { selectAppearancePreferences, useSettingsStore } from "@/stores/app";
import { directorySizeRecordForPath, entrySizeBytes } from "@/stores/explorer";
import type {
  ExplorerCommandQueryMode,
  ExplorerInlineEditState,
  ExplorerSortColumn,
  ExplorerSortState,
  ExplorerViewMode,
} from "@/stores/explorer";
import { formatBytes, formatDate } from "@/features/explorer/utils/fileFormat";
import {
  dragItemsForEntry,
  transferDropAcceptance,
} from "@/features/explorer/components/FileBrowserDrag";
import type { FileBrowserDragItem } from "@/models/types/features/explorer/components/FileBrowserDrag";
import { storageIdForPath } from "@/features/explorer/drag/operations";
import {
  useExplorerDragSource,
  useExplorerDropZone,
} from "@/features/explorer/drag/ExplorerDragContext";
import type {
  ExplorerDragModifiers,
  ExplorerDragPayload,
} from "@/models/interfaces/features/explorer/drag/types";
import {
  compileEntryFilterMatcher,
  entryMatchesQuery,
} from "@/features/explorer/components/FileBrowserFilters";
import { FileIcon, GenericFileIcon } from "@/features/explorer/components/FileBrowserIcons";
import {
  InlineCreateTableRow,
  InlineNameEditor,
  PassiveRenameDraftView,
} from "@/features/explorer/components/FileBrowserInline";
import type { PassiveRenameDraft } from "@/models/types/features/explorer/components/FileBrowserInline";
import { FileBrowserSkeleton } from "@/features/explorer/components/FileBrowserSkeleton";
import { fileBrowserStyles } from "@/features/explorer/components/FileBrowserStyles";

import type {
  FileTableColumn,
  FileTableColumnWidths,
  GridThumbnailSubscriber,
} from "@/models/types/features/explorer/components/FileBrowser";

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
