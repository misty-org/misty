import {
  ChevronDown,
  ChevronUp,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Image,
  Download,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { DirectoryListing, DirectorySizeRecord, FileEntry, FileSyncEndpoint, FileSyncPair } from "../../../api/types";
import { selectAppearancePreferences, useSettingsStore } from "../../settings/useSettingsStore";
import { directorySizeRecordForPath, entrySizeBytes } from "../state/useExplorerStore";
import type {
  ExplorerInlineEditState,
  ExplorerSortColumn,
  ExplorerSortState,
  ExplorerViewMode,
} from "../state/useExplorerStore";
import { useFileSyncStore } from "../state/useFileSyncStore";
import { formatBytes, formatDate } from "../utils/fileFormat";

const TABLE_ROW_HEIGHT = 44;
const TABLE_OVERSCAN_ROWS = 10;
const GRID_MIN_ITEM_WIDTH = 100;
const GRID_ITEM_HEIGHT = 104;
const GRID_GAP = 8;
const GRID_PADDING = 14;
const GRID_OVERSCAN_ROWS = 4;
const TABLE_COLUMN_STORAGE_KEY = "misty.explorer.fileTable.columnWidths";
const TABLE_COLUMN_ORDER_STORAGE_KEY = "misty.explorer.fileTable.columnOrder";
const DRAG_PREPARE_POINTER_THRESHOLD_PX = 6;
const emptyEntries: FileEntry[] = [];

const fileBrowserStyles = {
  browser:
    "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_36px] overflow-hidden",
  browserLoading: "bg-[#0e0e0e]",
  tableSkeleton:
    "min-h-0 min-w-[720px] overflow-hidden",
  tableSkeletonLine:
    "grid grid-cols-[minmax(240px,1fr)_220px_128px_128px] items-center gap-4 border-b border-[#262626] px-3.5",
  tableSkeletonHeader: "h-10 bg-[#171717]",
  tableSkeletonRow: "h-9 [[data-compact-mode=true]_&]:h-8",
  skeletonCell:
    "relative overflow-hidden rounded-md bg-[#171717] after:absolute after:inset-0 after:-translate-x-full after:animate-[misty-skeleton-sweep_1.15s_ease-in-out_infinite] after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.11),transparent)] after:content-['']",
  tableSkeletonHeaderCell: "h-[13px]",
  tableSkeletonCell: "h-3 first:h-4",
  gridSkeleton:
    "grid min-h-0 min-w-0 content-start justify-center gap-2 overflow-hidden p-3.5 [grid-template-columns:repeat(auto-fill,minmax(100px,100px))] [[data-compact-mode=true]_&]:gap-1.5 [[data-compact-mode=true]_&]:p-2.5 [[data-compact-mode=true]_&]:[grid-template-columns:repeat(auto-fill,minmax(92px,92px))]",
  gridSkeletonCell:
    "h-[104px] border border-[#222222] [[data-compact-mode=true]_&]:h-[92px]",
  tableWrap:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden",
  tableHeaderWrap:
    "min-w-0 overflow-hidden bg-[#111111]",
  tableScroll:
    "min-h-0 min-w-0 overflow-auto [overscroll-behavior:contain] [scrollbar-gutter:stable] max-[720px]:[scrollbar-gutter:auto]",
  table:
    "w-full min-w-[720px] table-fixed border-separate border-spacing-0 max-[720px]:min-w-0 max-[720px]:[&_td:first-child]:w-[64%] max-[720px]:[&_td:nth-child(2)]:w-[36%] max-[720px]:[&_td:nth-child(n+3)]:hidden max-[720px]:[&_th:first-child]:w-[64%] max-[720px]:[&_th:nth-child(2)]:w-[36%] max-[720px]:[&_th:nth-child(n+3)]:hidden",
  tableHeadCell:
    "group/header relative cursor-grab overflow-hidden whitespace-nowrap bg-[#111111] px-3 py-1 text-left align-middle text-sm font-semibold text-[#d5d5d5] shadow-[inset_0_-1px_#202020] max-[720px]:px-2.5 max-[720px]:py-1.5 max-[720px]:text-xs",
  tableHeadFiller:
    "bg-[#111111] p-0 shadow-[inset_0_-1px_#202020] max-[720px]:hidden",
  tableHeadDragging: "cursor-grabbing bg-[#212121] opacity-70",
  tableSort:
    "flex min-h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden border-0 bg-transparent p-0 pr-2 text-left font-[inherit] text-inherit",
  tableSortLabel: "min-w-0 overflow-hidden text-ellipsis",
  tableSortActive: "text-[#efefef]",
  tableSortIndicator:
    "inline-flex size-[13px] flex-none items-center justify-center text-[#a5a5a5]",
  tableResizeHandle:
    "absolute right-0 top-0 z-[2] h-full w-[8px] translate-x-1/2 cursor-col-resize after:absolute after:bottom-[8px] after:left-1/2 after:top-[8px] after:w-px after:-translate-x-1/2 after:bg-transparent after:content-[''] group-hover/header:after:bg-[#3a3a3a] max-[720px]:hidden",
  tableRow:
    "h-11 cursor-default select-none hover:bg-[#1e1e1e] [[data-compact-mode=true]_&]:h-9",
  tableRowSelected: "bg-[#1e1e1e]",
  tableRowDeleted: "text-[#a2a2a2]",
  tableRowInlineEditing: "relative z-[3]",
  tableCell:
    "cursor-default select-none overflow-hidden text-ellipsis whitespace-nowrap px-2.5 py-2 text-left text-sm leading-7 [[data-compact-mode=true]_&]:py-1.5 [[data-compact-mode=true]_&]:leading-6 max-[720px]:px-2 max-[720px]:py-1.5 max-[720px]:text-xs",
  directorySizeDots:
    "inline-flex h-7 w-8 items-center gap-1 align-middle [[data-compact-mode=true]_&]:h-6",
  directorySizeDot:
    "size-1.5 rounded-full bg-[#c7c7c7] opacity-85 motion-safe:animate-bounce",
  tableFillerCell: "p-0 max-[720px]:hidden",
  tableNameCell:
    "flex cursor-default select-none items-center gap-3 overflow-hidden text-ellipsis whitespace-nowrap px-2.5 py-2 text-left text-sm leading-7 [[data-compact-mode=true]_&]:gap-2 [[data-compact-mode=true]_&]:py-1.5 [[data-compact-mode=true]_&]:leading-6 max-[720px]:px-2 max-[720px]:py-1.5 max-[720px]:text-xs",
  tableNameCellEditing: "overflow-visible",
  tableNameText: "min-w-0 cursor-default select-none overflow-hidden text-ellipsis",
  downloadButton:
    "inline-grid size-6 place-items-center rounded-md border border-transparent bg-transparent text-[#a5a5a5] hover:border-[#3e3e3e] hover:bg-[#272727] hover:text-[#efefef]",
  rowDownloadButton: "ml-2 align-middle",
  gridDownloadButton:
    "absolute right-[5px] top-[5px] opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100",
  tableIconSlot: "grid h-6 w-6 flex-none place-items-center",
  folderIcon: "text-[#86b7ff]",
  deletedIcon: "text-[#ff8f99]",
  fileIcon: "text-[#a7c8ff]",
  iconArchive: "text-[#d6a3ff]",
  iconAudio: "text-[#c8a7ff]",
  iconCode: "text-[#7dd3fc]",
  iconImage: "text-[#79d99a]",
  iconSpreadsheet: "text-[#85d98f]",
  iconText: "text-[#d8e6ff]",
  iconVideo: "text-[#f4a6d7]",
  gridScroll:
    "min-h-0 min-w-0 overflow-auto [contain:layout_paint] [overscroll-behavior:contain] [scrollbar-gutter:stable]",
  gridSizer: "relative min-w-0",
  grid:
    "absolute left-3.5 right-3.5 grid content-start justify-center gap-2 [[data-compact-mode=true]_&]:left-2.5 [[data-compact-mode=true]_&]:right-2.5 [[data-compact-mode=true]_&]:gap-1.5",
  gridItem:
    "group/item relative grid min-h-[104px] min-w-0 cursor-default justify-items-center gap-2 rounded-lg border border-transparent bg-transparent px-2 py-3 text-[#d5d5d5] hover:border-[#353535] hover:bg-[#1e1e1e] [[data-compact-mode=true]_&]:min-h-[92px] [[data-compact-mode=true]_&]:gap-1.5 [[data-compact-mode=true]_&]:px-[7px] [[data-compact-mode=true]_&]:py-[9px]",
  gridItemSelected: "selected border-[#353535] bg-[#1e1e1e]",
  gridItemDeleted: "deleted text-[#a2a2a2] [&>span:not(.inline-name-editor)]:opacity-[0.86]",
  gridItemInlineEdit: "relative z-[2]",
  gridNameText: "max-w-full overflow-hidden text-ellipsis whitespace-nowrap",
  inlineEditor: "inline-name-editor relative inline-flex min-w-0 max-w-full items-center",
  inlineEditorGrid: "w-full justify-center",
  inlineEditorInvalid: "gap-[7px]",
  inlineFields:
    "inline-flex min-w-0 max-w-full items-center overflow-hidden rounded-[5px] border border-[#787878] bg-[#0d0d0d] shadow-[0_0_0_2px_rgba(120,120,120,0.18)]",
  inlineFieldsGrid: "w-full",
  inlineFieldsInvalid:
    "border-[#6e6e6e] shadow-[0_0_0_2px_rgba(109,109,109,0.16)]",
  inlineFieldsInvalidTable: "max-w-[174px]",
  inlineInput:
    "h-7 w-[min(210px,100%)] min-w-16 border-0 bg-transparent px-[7px] text-[#f0f0f0] outline-0",
  lockedExtension: "flex-none py-0 pl-0 pr-[7px] text-[#a2a2a2]",
  inlineError:
    "absolute left-0 top-[calc(100%+5px)] z-[8] w-max max-w-[260px] whitespace-normal rounded-[5px] border border-[#3f3f3f] bg-[#191919] px-[7px] py-[5px] text-[11px] leading-[1.3] text-[#c6c6c6] shadow-[0_8px_20px_rgba(0,0,0,0.38)]",
  inlineErrorTable:
    "static min-w-0 flex-auto overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-[#a2a2a2] shadow-none",
  passiveDraft:
    "inline-flex min-w-0 max-w-full items-center gap-0 overflow-hidden rounded-[5px] border border-[#444444] bg-[#101010] px-1.5 py-[3px] text-[#e5e5e5]",
  passiveDraftInvalid: "border-[#494949] text-[#cdcdcd]",
  passiveDraftText: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  passiveDraftExtension: "flex-none text-[inherit] text-[#989898]",
  passiveDraftCaret:
    "ml-0.5 h-4 w-px flex-none animate-[passive-rename-caret_1.1s_step-end_infinite] bg-[#b3b3b3] opacity-75",
  footer:
    "flex min-h-9 min-w-0 items-center justify-between gap-3 overflow-hidden border-t border-[#202020] px-3 py-1.5 text-xs text-[#949494] max-[720px]:min-h-8 max-[720px]:px-2.5 max-[720px]:py-0 max-[720px]:text-[11px]",
  footerGroup:
    "flex min-w-0 items-center gap-2 overflow-hidden",
  footerRight:
    "flex min-w-0 flex-none items-center justify-end gap-2 overflow-hidden",
  footerItem:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  footerButton:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-[#949494] hover:text-[#eeeeee]",
  footerButtonActive:
    "text-[#d0d0d0]",
  footerSeparator:
    "h-3 w-px flex-none bg-[#303030]",
  empty: "p-6 text-[#adadad]",
  emptyError: "text-[#a8a8a8]",
} as const;

type FileTableColumn = ExplorerSortColumn;
type FileTableColumnWidths = Record<FileTableColumn, number>;
type PassiveRenameDraft = {
  value: string;
  lockedExtension: string;
  error: string | null;
};

const fileTableColumns: FileTableColumn[] = ["name", "modified", "size", "type"];
const fileTableColumnLabels: Record<FileTableColumn, string> = {
  name: "Name",
  modified: "Modified",
  size: "Size",
  type: "Type",
};

const defaultColumnWidths: FileTableColumnWidths = {
  name: 220,
  modified: 220,
  size: 128,
  type: 128,
};

const minimumColumnWidths: FileTableColumnWidths = {
  name: 180,
  modified: 150,
  size: 92,
  type: 120,
};

interface FileBrowserProps {
  paneId: string;
  listing: DirectoryListing | null;
  selectedIds: string[];
  loading: boolean;
  error: string | null;
  viewMode: ExplorerViewMode;
  sort: ExplorerSortState;
  showHidden: boolean;
  commandQuery: string;
  directorySizes: Record<string, DirectorySizeRecord>;
  inlineEdit: ExplorerInlineEditState | null;
  onSort: (column: ExplorerSortColumn) => void;
  onToggleHidden: () => void;
  onSelect: (entryId: string, event: MouseEvent, visibleEntryIds: string[]) => void;
  onClearSelection: () => void;
  onOpen: (entry: FileEntry) => void;
  onDownload: (entry: FileEntry) => void;
  onContextMenu: (event: MouseEvent, entry: FileEntry) => void;
  onBackgroundContextMenu: (event: MouseEvent) => void;
  onPrepareDrag: (entry: FileEntry) => void;
  onDragStart: (event: DragEvent, entry: FileEntry) => void;
  onDragEnd: () => void;
  onDragHover: (destination: string) => void;
  onDrop: (event: DragEvent, destination: string) => void;
  onInlineEditChange: (value: string) => void;
  onInlineEditCommit: () => void;
  onInlineEditCancel: () => void;
}

export const FileBrowser = memo(function FileBrowser(props: FileBrowserProps) {
  const deferredCommandQuery = useDeferredValue(props.commandQuery);
  const trimmedCommandQuery = deferredCommandQuery.trim();
  const query = trimmedCommandQuery.startsWith(">") ? "" : trimmedCommandQuery.toLowerCase();
  const sourceEntries = props.listing?.entries ?? emptyEntries;
  const entries = useMemo(
    () => query ? sourceEntries.filter((entry) => entryMatchesQuery(entry, query)) : sourceEntries,
    [query, sourceEntries],
  );
  const syncLabel = usePaneSyncStatus(props.listing);

  if (props.error) {
    return <div className={`${fileBrowserStyles.empty} ${fileBrowserStyles.emptyError}`}>{props.error}</div>;
  }
  if (props.loading) {
    return <FileBrowserSkeleton viewMode={props.viewMode} />;
  }
  if (!props.listing) {
    return <div className={fileBrowserStyles.empty}>Choose a location to begin.</div>;
  }

  const queryActive = query.length > 0;
  const displayListing = entries === props.listing.entries ? props.listing : { ...props.listing, entries };
  const selectedEntries = props.listing.entries.filter((entry) => props.selectedIds.includes(entry.id) && !entry.isDeleted);
  const selectedBytes = selectedEntries.reduce((sum, entry) => sum + (entrySizeBytes(entry, props.directorySizes) ?? 0), 0);
  const selectionLabel = selectedEntries.length > 0
    ? `${selectedEntries.length} selected${selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ""}`
    : (queryActive ? `${entries.length} of ${props.listing.totalCount} items` : `${props.listing.totalCount} items`);
  const locationLabel = locationStatusLabel(props.listing);

  return (
    <section
      className={fileBrowserStyles.browser}
      data-drop-destination={props.listing.path}
      data-drop-kind="directory"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClearSelection();
      }}
      onContextMenu={props.onBackgroundContextMenu}
      onDragOver={(event) => {
        if (isMistyFileDrag(event) || isExternalFileDrag(event)) event.preventDefault();
      }}
      onDrop={(event) => props.onDrop(event, props.listing!.path)}
    >
      {props.viewMode === "grid" ? <FileGrid {...props} listing={displayListing} /> : <FileTable {...props} listing={displayListing} />}
      <footer className={fileBrowserStyles.footer}>
        <div className={fileBrowserStyles.footerGroup}>
          <span className={fileBrowserStyles.footerItem}>{selectionLabel}</span>
        </div>
        <div className={fileBrowserStyles.footerRight}>
          <span className={fileBrowserStyles.footerItem}>{locationLabel}</span>
          <span className={fileBrowserStyles.footerSeparator} aria-hidden="true" />
          <button
            className={`${fileBrowserStyles.footerButton} ${props.showHidden ? fileBrowserStyles.footerButtonActive : ""}`}
            type="button"
            title={props.showHidden ? "Hide hidden files" : "Show hidden files"}
            onClick={props.onToggleHidden}
          >
            {props.listing.hiddenCount} hidden
          </button>
          <span className={fileBrowserStyles.footerSeparator} aria-hidden="true" />
          <span className={fileBrowserStyles.footerItem}>{syncLabel}</span>
        </div>
      </footer>
    </section>
  );
});

function FileBrowserSkeleton(props: { viewMode: ExplorerViewMode }) {
  const rows = Array.from({ length: 12 }, (_, index) => index);
  const tiles = Array.from({ length: 20 }, (_, index) => index);

  return (
    <section className={`${fileBrowserStyles.browser} ${fileBrowserStyles.browserLoading}`} aria-busy="true" aria-label="Loading directory">
      {props.viewMode === "grid" ? (
        <div className={fileBrowserStyles.gridSkeleton} aria-hidden="true">
          {tiles.map((index) => <span className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.gridSkeletonCell}`} key={index} />)}
        </div>
      ) : (
        <div className={fileBrowserStyles.tableSkeleton} aria-hidden="true">
          <div className={`${fileBrowserStyles.tableSkeletonLine} ${fileBrowserStyles.tableSkeletonHeader}`}>
            <span className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonHeaderCell}`} />
            <span className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonHeaderCell}`} />
            <span className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonHeaderCell}`} />
            <span className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonHeaderCell}`} />
          </div>
          {rows.map((index) => (
            <div className={`${fileBrowserStyles.tableSkeletonLine} ${fileBrowserStyles.tableSkeletonRow}`} key={index}>
              <span className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonCell}`} />
              <span className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonCell}`} />
              <span className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonCell}`} />
              <span className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonCell}`} />
            </div>
          ))}
        </div>
      )}
      <footer className={fileBrowserStyles.footer}>Loading directory...</footer>
    </section>
  );
}

function usePaneSyncStatus(listing: DirectoryListing | null): string {
  const { pairs, loadingPairs, pairsLoaded, loadPairs } = useFileSyncStore(useShallow((state) => ({
    pairs: state.pairs,
    loadingPairs: state.loadingPairs,
    pairsLoaded: state.pairsLoaded,
    loadPairs: state.loadPairs,
  })));

  useEffect(() => {
    if (!pairsLoaded && !loadingPairs) void loadPairs();
  }, [loadPairs, loadingPairs, pairsLoaded]);

  if (!listing) return "Sync idle";
  if (loadingPairs && pairs.length === 0) return "Sync...";
  const pair = pairs.find((candidate) => syncPairCoversListing(candidate, listing));
  if (!pair) return "Not synced";
  if (pair.watchMode) return "Sync watching";
  if (pair.stale) return "Sync stale";
  return "Sync pair";
}

function locationStatusLabel(listing: DirectoryListing): string {
  const location = listing.location;
  if (location.kind === "local") return "Local";
  if (location.remoteName) return location.providerType ? `${location.providerType} · ${location.remoteName}` : location.remoteName;
  return location.providerType ?? "Remote";
}

function syncPairCoversListing(pair: FileSyncPair, listing: DirectoryListing): boolean {
  return syncEndpointCoversListing(pair.left, listing) || syncEndpointCoversListing(pair.right, listing);
}

function syncEndpointCoversListing(endpoint: FileSyncEndpoint, listing: DirectoryListing): boolean {
  const location = listing.location;
  if (endpoint.kind === "local") {
    if (location.kind !== "local") return false;
    return pathContains(endpoint.localPath, listing.path);
  }
  if (location.kind === "local") return false;
  if (endpoint.remoteName && location.remoteName && endpoint.remoteName !== location.remoteName) return false;
  return pathContains(endpoint.remotePath || "/", location.remotePath || listing.path);
}

function pathContains(rootPath: string, candidatePath: string): boolean {
  const root = normalizeStatusPath(rootPath);
  const candidate = normalizeStatusPath(candidatePath);
  return candidate === root || candidate.startsWith(`${root}/`) || root === "/";
}

function normalizeStatusPath(path: string): string {
  const normalized = (path || "/").replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized || "/";
}

function FileTable(props: FileBrowserProps & { listing: DirectoryListing }) {
  const compactModeEnabled = useSettingsStore((state) =>
    selectAppearancePreferences(state.settings?.document).compactModeEnabled,
  );
  const headerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const viewportHeightRef = useRef(0);
  const viewportWidthRef = useRef(0);
  const scrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [columnWidths, setColumnWidths] = useState<FileTableColumnWidths>(loadColumnWidths);
  const [columnOrder, setColumnOrder] = useState<FileTableColumn[]>(loadColumnOrder);
  const [draggedColumn, setDraggedColumn] = useState<FileTableColumn | null>(null);
  const selectedIds = useMemo(() => new Set(props.selectedIds), [props.selectedIds]);
  const visibleEntryIds = useMemo(() => props.listing.entries.map((entry) => entry.id), [props.listing.entries]);
  const passiveRenameDrafts = useMemo(() => passiveRenameDraftsFor(props.inlineEdit, props.paneId), [props.inlineEdit, props.paneId]);
  const activeInlineEdit = props.inlineEdit?.paneId === props.paneId ? props.inlineEdit : null;
  const rowHeight = compactModeEnabled ? 36 : TABLE_ROW_HEIGHT;
  const rowCount = props.listing.entries.length;
  const tableWidth = columnOrder.reduce((sum, column) => sum + columnWidths[column], 0);
  const fillerColumnWidth = Math.max(0, viewportWidth - tableWidth);
  const hasFillerColumn = fillerColumnWidth >= 1;
  const renderedTableWidth = tableWidth + fillerColumnWidth;
  const tableColumnCount = columnOrder.length + (hasFillerColumn ? 1 : 0);
  const visibleCapacity = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - TABLE_OVERSCAN_ROWS);
  const endIndex = Math.min(rowCount, startIndex + visibleCapacity + TABLE_OVERSCAN_ROWS * 2);
  const visibleEntries = props.listing.entries.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * rowHeight;
  const bottomSpacerHeight = Math.max(0, (rowCount - endIndex) * rowHeight);

  const updateViewport = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (viewportHeightRef.current !== element.clientHeight) {
      viewportHeightRef.current = element.clientHeight;
      setViewportHeight(element.clientHeight);
    }
    if (viewportWidthRef.current !== element.clientWidth) {
      viewportWidthRef.current = element.clientWidth;
      setViewportWidth(element.clientWidth);
    }
    if (scrollTopRef.current !== element.scrollTop) {
      scrollTopRef.current = element.scrollTop;
      setScrollTop(element.scrollTop);
    }
    if (headerRef.current && headerRef.current.scrollLeft !== element.scrollLeft) {
      headerRef.current.scrollLeft = element.scrollLeft;
    }
  }, []);

  useEffect(() => {
    updateViewport();
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [props.listing.path, rowCount, updateViewport]);

  useEffect(() => {
    const edit = props.inlineEdit;
    if (!edit) return;
    if (edit.kind === "create") {
      scrollRef.current?.scrollTo({ top: 0 });
      return;
    }
    const index = props.listing.entries.findIndex((entry) => entry.id === edit.entryId);
    const element = scrollRef.current;
    if (index < 0 || !element) return;
    const rowTop = index * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < element.scrollTop) element.scrollTo({ top: rowTop });
    else if (rowBottom > element.scrollTop + element.clientHeight) {
      element.scrollTo({ top: rowBottom - element.clientHeight });
    }
  }, [props.inlineEdit?.entryId, props.inlineEdit?.kind, props.listing.path, rowHeight]);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const element = scrollRef.current;
      if (!element) return;
      if (headerRef.current && headerRef.current.scrollLeft !== element.scrollLeft) {
        headerRef.current.scrollLeft = element.scrollLeft;
      }
      if (scrollTopRef.current !== element.scrollTop) {
        scrollTopRef.current = element.scrollTop;
        setScrollTop(element.scrollTop);
      }
    });
  }, []);

  const beginColumnResize = useCallback((column: ExplorerSortColumn, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column];
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    let pendingWidth = startWidth;
    let frame: number | null = null;
    const applyWidth = () => {
      frame = null;
      setColumnWidths((current) => current[column] === pendingWidth ? current : { ...current, [column]: pendingWidth });
    };
    const onPointerMove = (moveEvent: PointerEvent) => {
      pendingWidth = Math.max(minimumColumnWidths[column], startWidth + moveEvent.clientX - startX);
      if (frame === null) frame = window.requestAnimationFrame(applyWidth);
    };
    const onPointerUp = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      const next = { ...columnWidths, [column]: pendingWidth };
      setColumnWidths(next);
      saveColumnWidths(next);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }, [columnWidths]);

  const reorderColumn = useCallback((source: FileTableColumn, target: FileTableColumn) => {
    if (source === target) return;
    setColumnOrder((current) => {
      const withoutSource = current.filter((column) => column !== source);
      const targetIndex = withoutSource.indexOf(target);
      if (targetIndex < 0) return current;
      const next = [...withoutSource.slice(0, targetIndex), source, ...withoutSource.slice(targetIndex)];
      saveColumnOrder(next);
      return next;
    });
  }, []);
  const handleSelect = useCallback(
    (entryId: string, event: MouseEvent) => props.onSelect(entryId, event, visibleEntryIds),
    [props.onSelect, visibleEntryIds],
  );

  return (
    <div className={fileBrowserStyles.tableWrap}>
      <div ref={headerRef} className={fileBrowserStyles.tableHeaderWrap}>
        <table className={fileBrowserStyles.table} style={{ width: renderedTableWidth, minWidth: renderedTableWidth }}>
          <colgroup>
            {columnOrder.map((column) => <col key={column} style={{ width: columnWidths[column] }} />)}
            {hasFillerColumn ? <col style={{ width: fillerColumnWidth }} /> : null}
          </colgroup>
          <thead>
            <tr>
              {columnOrder.map((column) => (
                <SortableHeader
                  key={column}
                  label={fileTableColumnLabels[column]}
                  column={column}
                  sort={props.sort}
                  dragging={draggedColumn === column}
                  onSort={props.onSort}
                  onResizeStart={beginColumnResize}
                  onDragStart={(dragColumn) => setDraggedColumn(dragColumn)}
                  onDragEnd={() => setDraggedColumn(null)}
                  onColumnDrop={reorderColumn}
                />
              ))}
              {hasFillerColumn ? <th className={fileBrowserStyles.tableHeadFiller} aria-hidden="true" /> : null}
            </tr>
          </thead>
        </table>
      </div>
      <div
        ref={scrollRef}
        className={fileBrowserStyles.tableScroll}
        onScroll={handleScroll}
      >
        <table className={fileBrowserStyles.table} style={{ width: renderedTableWidth, minWidth: renderedTableWidth }}>
          <colgroup>
            {columnOrder.map((column) => <col key={column} style={{ width: columnWidths[column] }} />)}
            {hasFillerColumn ? <col style={{ width: fillerColumnWidth }} /> : null}
          </colgroup>
          <tbody>
            {props.inlineEdit?.kind === "create" ? (
              <InlineCreateTableRow
                edit={props.inlineEdit}
                columns={columnOrder}
                hasFillerColumn={hasFillerColumn}
                onChange={props.onInlineEditChange}
                onCommit={props.onInlineEditCommit}
                onCancel={props.onInlineEditCancel}
              />
            ) : null}
            {topSpacerHeight > 0 ? <tr aria-hidden="true"><td colSpan={tableColumnCount} style={{ height: topSpacerHeight, padding: 0 }} /></tr> : null}
            {visibleEntries.map((entry) => (
              <FileTableRow
                key={entry.id}
                entry={entry}
                columns={columnOrder}
                hasFillerColumn={hasFillerColumn}
                selected={selectedIds.has(entry.id)}
                onSelect={handleSelect}
                onOpen={props.onOpen}
                onDownload={props.onDownload}
                onContextMenu={props.onContextMenu}
                onPrepareDrag={props.onPrepareDrag}
                onDragStart={props.onDragStart}
                onDragEnd={props.onDragEnd}
                onDragHover={props.onDragHover}
                onDrop={props.onDrop}
                inlineEdit={activeInlineEdit?.entryId === entry.id ? activeInlineEdit : null}
                passiveRename={passiveRenameDrafts.get(entry.id) ?? null}
                directorySizes={props.directorySizes}
                onInlineEditChange={props.onInlineEditChange}
                onInlineEditCommit={props.onInlineEditCommit}
                onInlineEditCancel={props.onInlineEditCancel}
              />
            ))}
            {bottomSpacerHeight > 0 ? <tr aria-hidden="true"><td colSpan={tableColumnCount} style={{ height: bottomSpacerHeight, padding: 0 }} /></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SortableHeader = memo(function SortableHeader(props: {
  label: string;
  column: FileTableColumn;
  sort: ExplorerSortState;
  dragging: boolean;
  onSort: (column: FileTableColumn) => void;
  onResizeStart: (column: FileTableColumn, event: ReactPointerEvent) => void;
  onDragStart: (column: FileTableColumn) => void;
  onDragEnd: () => void;
  onColumnDrop: (source: FileTableColumn, target: FileTableColumn) => void;
}) {
  const active = props.sort.column === props.column;
  const direction = active ? props.sort.direction : null;
  return (
    <th
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={`${fileBrowserStyles.tableHeadCell} ${props.dragging ? fileBrowserStyles.tableHeadDragging : ""}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-misty-file-column", props.column);
        props.onDragStart(props.column);
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-misty-file-column")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => {
        const source = event.dataTransfer.getData("application/x-misty-file-column") as FileTableColumn;
        if (isFileTableColumn(source)) {
          event.preventDefault();
          props.onColumnDrop(source, props.column);
        }
        props.onDragEnd();
      }}
    >
      <button className={`${fileBrowserStyles.tableSort} ${active ? fileBrowserStyles.tableSortActive : ""}`} onClick={() => props.onSort(props.column)}>
        <span className={fileBrowserStyles.tableSortLabel}>{props.label}</span>
        <span className={fileBrowserStyles.tableSortIndicator}>
          {active ? (direction === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : null}
        </span>
      </button>
      <span
        className={fileBrowserStyles.tableResizeHandle}
        aria-hidden="true"
        draggable={false}
        onPointerDown={(event) => props.onResizeStart(props.column, event)}
        onDragStart={(event) => event.preventDefault()}
      />
    </th>
  );
});

const FileTableRow = memo(function FileTableRow(props: {
  entry: FileEntry;
  columns: FileTableColumn[];
  hasFillerColumn: boolean;
  selected: boolean;
  onSelect: FileBrowserProps["onSelect"];
  onOpen: FileBrowserProps["onOpen"];
  onDownload: FileBrowserProps["onDownload"];
  onContextMenu: FileBrowserProps["onContextMenu"];
  onPrepareDrag: FileBrowserProps["onPrepareDrag"];
  onDragStart: FileBrowserProps["onDragStart"];
  onDragEnd: FileBrowserProps["onDragEnd"];
  onDragHover: FileBrowserProps["onDragHover"];
  onDrop: FileBrowserProps["onDrop"];
  inlineEdit: ExplorerInlineEditState | null;
  passiveRename: PassiveRenameDraft | null;
  directorySizes: Record<string, DirectorySizeRecord>;
  onInlineEditChange: FileBrowserProps["onInlineEditChange"];
  onInlineEditCommit: FileBrowserProps["onInlineEditCommit"];
  onInlineEditCancel: FileBrowserProps["onInlineEditCancel"];
}) {
  const { entry } = props;
  const pendingDragPreparationRef = useRef<{
    entry: FileEntry;
    pointerId: number;
    startX: number;
    startY: number;
    prepared: boolean;
  } | null>(null);
  const handlePointerDown = useCallback((event: ReactPointerEvent) => {
    if (entry.isDeleted || event.button !== 0) {
      pendingDragPreparationRef.current = null;
      return;
    }
    pendingDragPreparationRef.current = {
      entry,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      prepared: false,
    };
  }, [entry]);
  const handlePointerMove = useCallback((event: ReactPointerEvent) => {
    const pending = pendingDragPreparationRef.current;
    if (!pending || pending.prepared || pending.pointerId !== event.pointerId || (event.buttons & 1) === 0) return;
    const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
    if (distance < DRAG_PREPARE_POINTER_THRESHOLD_PX) return;
    pending.prepared = true;
    props.onPrepareDrag(pending.entry);
  }, [props.onPrepareDrag]);
  const clearPendingDragPreparation = useCallback(() => {
    pendingDragPreparationRef.current = null;
  }, []);
  const handleDragStart = useCallback((event: DragEvent) => {
    const pending = pendingDragPreparationRef.current;
    if (!pending?.prepared) {
      event.preventDefault();
      clearPendingDragPreparation();
      return;
    }
    props.onDragStart(event, entry);
  }, [clearPendingDragPreparation, entry, props.onDragStart]);

  return (
    <tr
      className={`${fileBrowserStyles.tableRow} ${props.selected ? fileBrowserStyles.tableRowSelected : ""} ${props.inlineEdit ? fileBrowserStyles.tableRowInlineEditing : ""} ${entry.isDeleted ? fileBrowserStyles.tableRowDeleted : ""}`}
      data-drop-destination={!entry.isDeleted && entry.kind === "folder" ? entry.path : undefined}
      data-drop-kind={!entry.isDeleted && entry.kind === "folder" ? "folder" : undefined}
      onClick={(event) => props.onSelect(entry.id, event, [])}
      onDoubleClick={() => {
        if (!entry.isDeleted) props.onOpen(entry);
      }}
      onContextMenu={(event) => props.onContextMenu(event, entry)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearPendingDragPreparation}
      onPointerCancel={clearPendingDragPreparation}
      draggable={!props.inlineEdit && !entry.isDeleted}
      onDragStart={handleDragStart}
      onDragEnd={() => {
        clearPendingDragPreparation();
        props.onDragEnd();
      }}
      onDragOver={(event) => {
        if (!entry.isDeleted && entry.kind === "folder") {
          event.preventDefault();
          props.onDragHover(entry.path);
        }
      }}
      onDrop={(event) => {
        if (entry.isDeleted || entry.kind !== "folder") return;
        event.stopPropagation();
        props.onDrop(event, entry.path);
      }}
    >
      {props.columns.map((column) => (
        <FileTableCell
          key={column}
          column={column}
          entry={entry}
          inlineEdit={props.inlineEdit}
          passiveRename={props.passiveRename}
          directorySizes={props.directorySizes}
          onDownload={props.onDownload}
          onInlineEditChange={props.onInlineEditChange}
          onInlineEditCommit={props.onInlineEditCommit}
          onInlineEditCancel={props.onInlineEditCancel}
        />
      ))}
      {props.hasFillerColumn ? <td className={fileBrowserStyles.tableFillerCell} aria-hidden="true" /> : null}
    </tr>
  );
});

function FileTableCell(props: {
  column: FileTableColumn;
  entry: FileEntry;
  inlineEdit: ExplorerInlineEditState | null;
  passiveRename: PassiveRenameDraft | null;
  directorySizes: Record<string, DirectorySizeRecord>;
  onDownload: FileBrowserProps["onDownload"];
  onInlineEditChange: FileBrowserProps["onInlineEditChange"];
  onInlineEditCommit: FileBrowserProps["onInlineEditCommit"];
  onInlineEditCancel: FileBrowserProps["onInlineEditCancel"];
}) {
  switch (props.column) {
    case "name":
      return (
        <td className={`${fileBrowserStyles.tableNameCell} ${props.inlineEdit ? fileBrowserStyles.tableNameCellEditing : ""}`}>
          <span className={fileBrowserStyles.tableIconSlot}>
            <FileIcon entry={props.entry} variant="table" />
          </span>
          {props.inlineEdit ? (
            <InlineNameEditor
              edit={props.inlineEdit}
              variant="table"
              onChange={props.onInlineEditChange}
              onCommit={props.onInlineEditCommit}
              onCancel={props.onInlineEditCancel}
            />
          ) : props.passiveRename ? (
            <PassiveRenameDraftView draft={props.passiveRename} />
          ) : <span className={fileBrowserStyles.tableNameText}>{props.entry.name}</span>}
        </td>
      );
    case "modified":
      return <td className={fileBrowserStyles.tableCell}>{formatDate(props.entry.remoteModified ?? props.entry.modifiedMs)}</td>;
    case "size":
      return <td className={fileBrowserStyles.tableCell}>{formatEntrySize(props.entry, props.directorySizes)}</td>;
    case "type":
      if (props.entry.isDeleted) return <td className={fileBrowserStyles.tableCell}>Deleted</td>;
      return (
        <td className={fileBrowserStyles.tableCell}>
          <span>{props.entry.kind === "folder" ? "Folder" : props.entry.mimeType || props.entry.extension || props.entry.kind}</span>
          {isDownloadableRemoteFile(props.entry) ? (
            <button
              type="button"
              className={`${fileBrowserStyles.downloadButton} ${fileBrowserStyles.rowDownloadButton}`}
              title="Download"
              aria-label={`Download ${props.entry.name}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onDownload(props.entry);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Download size={15} />
            </button>
          ) : null}
        </td>
      );
  }
}

function FileGrid(props: FileBrowserProps & { listing: DirectoryListing }) {
  const compactModeEnabled = useSettingsStore((state) =>
    selectAppearancePreferences(state.settings?.document).compactModeEnabled,
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const viewportHeightRef = useRef(0);
  const viewportWidthRef = useRef(0);
  const scrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const selectedIds = useMemo(() => new Set(props.selectedIds), [props.selectedIds]);
  const visibleEntryIds = useMemo(() => props.listing.entries.map((entry) => entry.id), [props.listing.entries]);
  const passiveRenameDrafts = useMemo(() => passiveRenameDraftsFor(props.inlineEdit, props.paneId), [props.inlineEdit, props.paneId]);
  const activeInlineEdit = props.inlineEdit?.paneId === props.paneId ? props.inlineEdit : null;
  const createOffset = props.inlineEdit?.kind === "create" ? 1 : 0;
  const itemCount = props.listing.entries.length + createOffset;
  const gridPadding = compactModeEnabled ? 10 : GRID_PADDING;
  const gridGap = compactModeEnabled ? 6 : GRID_GAP;
  const gridItemHeight = compactModeEnabled ? 92 : GRID_ITEM_HEIGHT;
  const gridMinItemWidth = compactModeEnabled ? 92 : GRID_MIN_ITEM_WIDTH;
  const usableWidth = Math.max(1, viewportWidth - gridPadding * 2);
  const columns = Math.max(1, Math.floor((usableWidth + gridGap) / (gridMinItemWidth + gridGap)));
  const rowStride = gridItemHeight + gridGap;
  const rowCount = Math.ceil(itemCount / columns);
  const totalHeight = gridPadding * 2 + Math.max(0, rowCount * gridItemHeight + Math.max(0, rowCount - 1) * gridGap);
  const visibleRowCapacity = Math.max(1, Math.ceil(viewportHeight / rowStride));
  const startRow = Math.max(0, Math.floor(Math.max(0, scrollTop - gridPadding) / rowStride) - GRID_OVERSCAN_ROWS);
  const endRow = Math.min(rowCount, startRow + visibleRowCapacity + GRID_OVERSCAN_ROWS * 2);
  const startIndex = startRow * columns;
  const endIndex = Math.min(itemCount, endRow * columns);
  const visibleItems = useMemo(() => {
    const items: Array<{ kind: "create"; key: string } | { kind: "entry"; key: string; entry: FileEntry }> = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      if (index === 0 && createOffset) {
        items.push({ kind: "create", key: "inline-create" });
        continue;
      }
      const entry = props.listing.entries[index - createOffset];
      if (entry) items.push({ kind: "entry", key: entry.id, entry });
    }
    return items;
  }, [createOffset, endIndex, props.listing.entries, startIndex]);
  const gridTop = gridPadding + startRow * rowStride;

  const updateViewport = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (viewportHeightRef.current !== element.clientHeight) {
      viewportHeightRef.current = element.clientHeight;
      setViewportHeight(element.clientHeight);
    }
    if (viewportWidthRef.current !== element.clientWidth) {
      viewportWidthRef.current = element.clientWidth;
      setViewportWidth(element.clientWidth);
    }
    if (scrollTopRef.current !== element.scrollTop) {
      scrollTopRef.current = element.scrollTop;
      setScrollTop(element.scrollTop);
    }
  }, []);

  useEffect(() => {
    updateViewport();
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [itemCount, props.listing.path, updateViewport]);

  useEffect(() => {
    const edit = props.inlineEdit;
    if (!edit) return;
    if (edit.kind === "create") {
      scrollRef.current?.scrollTo({ top: 0 });
      return;
    }
    const index = props.listing.entries.findIndex((entry) => entry.id === edit.entryId);
    const element = scrollRef.current;
    if (index < 0 || !element) return;
    const itemIndex = index + createOffset;
    const rowTop = gridPadding + Math.floor(itemIndex / columns) * rowStride;
    const rowBottom = rowTop + gridItemHeight;
    if (rowTop < element.scrollTop) element.scrollTo({ top: rowTop });
    else if (rowBottom > element.scrollTop + element.clientHeight) {
      element.scrollTo({ top: rowBottom - element.clientHeight });
    }
  }, [columns, createOffset, gridItemHeight, gridPadding, props.inlineEdit?.entryId, props.inlineEdit?.kind, props.listing.path, rowStride]);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const element = scrollRef.current;
      if (!element) return;
      if (scrollTopRef.current !== element.scrollTop) {
        scrollTopRef.current = element.scrollTop;
        setScrollTop(element.scrollTop);
      }
    });
  }, []);
  const handleSelect = useCallback(
    (entryId: string, event: MouseEvent) => props.onSelect(entryId, event, visibleEntryIds),
    [props.onSelect, visibleEntryIds],
  );

  return (
    <div ref={scrollRef} className={fileBrowserStyles.gridScroll} onScroll={handleScroll}>
      <div className={fileBrowserStyles.gridSizer} style={{ height: totalHeight }}>
        <div
          className={fileBrowserStyles.grid}
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, ${gridMinItemWidth}px))`,
            top: gridTop,
          }}
        >
          {visibleItems.map((item) => {
            if (item.kind === "create") {
              return (
                <div key={item.key} className={`${fileBrowserStyles.gridItem} ${fileBrowserStyles.gridItemInlineEdit} ${fileBrowserStyles.gridItemSelected}`}>
                  {props.inlineEdit?.itemKind === "folder" ? <Folder size={32} className={fileBrowserStyles.folderIcon} /> : <File size={32} className={fileBrowserStyles.fileIcon} />}
                  {props.inlineEdit ? (
                    <InlineNameEditor
                      edit={props.inlineEdit}
                      variant="grid"
                      onChange={props.onInlineEditChange}
                      onCommit={props.onInlineEditCommit}
                      onCancel={props.onInlineEditCancel}
                    />
                  ) : null}
                </div>
              );
            }
            return (
              <FileGridItem
                key={item.key}
                entry={item.entry}
                selected={selectedIds.has(item.entry.id)}
                inlineEdit={activeInlineEdit?.entryId === item.entry.id ? activeInlineEdit : null}
                passiveRename={passiveRenameDrafts.get(item.entry.id) ?? null}
                onSelect={handleSelect}
                onOpen={props.onOpen}
                onDownload={props.onDownload}
                onContextMenu={props.onContextMenu}
                onPrepareDrag={props.onPrepareDrag}
                onDragStart={props.onDragStart}
                onDragEnd={props.onDragEnd}
                onDragHover={props.onDragHover}
                onDrop={props.onDrop}
                onInlineEditChange={props.onInlineEditChange}
                onInlineEditCommit={props.onInlineEditCommit}
                onInlineEditCancel={props.onInlineEditCancel}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

const FileGridItem = memo(function FileGridItem(props: {
  entry: FileEntry;
  selected: boolean;
  inlineEdit: ExplorerInlineEditState | null;
  passiveRename: PassiveRenameDraft | null;
  onSelect: FileBrowserProps["onSelect"];
  onOpen: FileBrowserProps["onOpen"];
  onDownload: FileBrowserProps["onDownload"];
  onContextMenu: FileBrowserProps["onContextMenu"];
  onPrepareDrag: FileBrowserProps["onPrepareDrag"];
  onDragStart: FileBrowserProps["onDragStart"];
  onDragEnd: FileBrowserProps["onDragEnd"];
  onDragHover: FileBrowserProps["onDragHover"];
  onDrop: FileBrowserProps["onDrop"];
  onInlineEditChange: FileBrowserProps["onInlineEditChange"];
  onInlineEditCommit: FileBrowserProps["onInlineEditCommit"];
  onInlineEditCancel: FileBrowserProps["onInlineEditCancel"];
}) {
  const { entry } = props;
  const pendingDragPreparationRef = useRef<{
    entry: FileEntry;
    pointerId: number;
    startX: number;
    startY: number;
    prepared: boolean;
  } | null>(null);
  const handlePointerDown = useCallback((event: ReactPointerEvent) => {
    if (entry.isDeleted || event.button !== 0) {
      pendingDragPreparationRef.current = null;
      return;
    }
    pendingDragPreparationRef.current = {
      entry,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      prepared: false,
    };
  }, [entry]);
  const handlePointerMove = useCallback((event: ReactPointerEvent) => {
    const pending = pendingDragPreparationRef.current;
    if (!pending || pending.prepared || pending.pointerId !== event.pointerId || (event.buttons & 1) === 0) return;
    const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
    if (distance < DRAG_PREPARE_POINTER_THRESHOLD_PX) return;
    pending.prepared = true;
    props.onPrepareDrag(pending.entry);
  }, [props.onPrepareDrag]);
  const clearPendingDragPreparation = useCallback(() => {
    pendingDragPreparationRef.current = null;
  }, []);
  const handleDragStart = useCallback((event: DragEvent) => {
    const pending = pendingDragPreparationRef.current;
    if (!pending?.prepared) {
      event.preventDefault();
      clearPendingDragPreparation();
      return;
    }
    props.onDragStart(event, entry);
  }, [clearPendingDragPreparation, entry, props.onDragStart]);

  return (
    <div
      className={`${fileBrowserStyles.gridItem} ${props.selected ? fileBrowserStyles.gridItemSelected : ""} ${entry.isDeleted ? fileBrowserStyles.gridItemDeleted : ""}`}
      data-drop-destination={!entry.isDeleted && entry.kind === "folder" ? entry.path : undefined}
      data-drop-kind={!entry.isDeleted && entry.kind === "folder" ? "folder" : undefined}
      role="button"
      tabIndex={0}
      onClick={(event) => props.onSelect(entry.id, event, [])}
      onDoubleClick={() => {
        if (!entry.isDeleted) props.onOpen(entry);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !entry.isDeleted) props.onOpen(entry);
      }}
      onContextMenu={(event) => props.onContextMenu(event, entry)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearPendingDragPreparation}
      onPointerCancel={clearPendingDragPreparation}
      draggable={!props.inlineEdit && !entry.isDeleted}
      onDragStart={handleDragStart}
      onDragEnd={() => {
        clearPendingDragPreparation();
        props.onDragEnd();
      }}
      onDragOver={(event) => {
        if (!entry.isDeleted && entry.kind === "folder") {
          event.preventDefault();
          props.onDragHover(entry.path);
        }
      }}
      onDrop={(event) => {
        if (entry.isDeleted || entry.kind !== "folder") return;
        event.stopPropagation();
        props.onDrop(event, entry.path);
      }}
    >
      {isDownloadableRemoteFile(entry) ? (
        <button
          type="button"
          className={`${fileBrowserStyles.downloadButton} ${fileBrowserStyles.gridDownloadButton} ${props.selected ? "opacity-100" : ""}`}
          title="Download"
          aria-label={`Download ${entry.name}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onDownload(entry);
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Download size={15} />
        </button>
      ) : null}
      <FileIcon entry={entry} size={32} />
      {props.inlineEdit ? (
        <InlineNameEditor
          edit={props.inlineEdit}
          variant="grid"
          onChange={props.onInlineEditChange}
          onCommit={props.onInlineEditCommit}
          onCancel={props.onInlineEditCancel}
        />
      ) : props.passiveRename ? (
        <PassiveRenameDraftView draft={props.passiveRename} />
      ) : <span className={fileBrowserStyles.gridNameText}>{entry.name}</span>}
    </div>
  );
});

function isDownloadableRemoteFile(entry: FileEntry): boolean {
  return entry.location.kind === "remote" && entry.kind !== "folder" && !entry.isDeleted;
}

function formatEntrySize(
  entry: FileEntry,
  directorySizes: Record<string, DirectorySizeRecord>,
): ReactNode {
  if (entry.kind !== "folder") return formatBytes(entry.sizeBytes);
  const record = directorySizeRecordForPath(directorySizes, entry.path);
  if (record?.status === "calculating") return <DirectorySizeDots />;
  if (record?.status === "ready") return formatBytes(record.sizeBytes);
  return formatBytes(null);
}

function DirectorySizeDots() {
  return (
    <span className={fileBrowserStyles.directorySizeDots} aria-label="Calculating folder size">
      {[0, 1, 2].map((index) => (
        <span
          className={fileBrowserStyles.directorySizeDot}
          style={{ animationDelay: `${index * 120}ms` }}
          aria-hidden="true"
          key={index}
        />
      ))}
    </span>
  );
}

function InlineCreateTableRow(props: {
  edit: ExplorerInlineEditState;
  columns: FileTableColumn[];
  hasFillerColumn: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const entry = {
    kind: props.edit.itemKind === "folder" ? "folder" : "file",
  } as FileEntry;
  return (
    <tr className={`${fileBrowserStyles.tableRow} ${fileBrowserStyles.tableRowSelected}`}>
      {props.columns.map((column) => {
        if (column === "name") {
          return (
            <td className={`${fileBrowserStyles.tableNameCell} ${fileBrowserStyles.tableNameCellEditing}`} key={column}>
              <FileIcon entry={entry} />
              <InlineNameEditor {...props} variant="table" />
            </td>
          );
        }
        if (column === "type") return <td className={fileBrowserStyles.tableCell} key={column}>{props.edit.itemKind === "folder" ? "Folder" : "File"}</td>;
        return <td className={fileBrowserStyles.tableCell} key={column}>--</td>;
      })}
      {props.hasFillerColumn ? <td className={fileBrowserStyles.tableFillerCell} aria-hidden="true" /> : null}
    </tr>
  );
}

function InlineNameEditor(props: {
  edit: ExplorerInlineEditState;
  variant?: "table" | "grid";
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sessionKey = `${props.edit.paneId}:${props.edit.kind}:${props.edit.entryId ?? "new"}:${props.edit.originalName}`;

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, props.edit.value.length);
  }, [sessionKey]);

  return (
    <span
      className={[
        fileBrowserStyles.inlineEditor,
        props.variant === "grid" ? fileBrowserStyles.inlineEditorGrid : "",
        props.edit.error ? fileBrowserStyles.inlineEditorInvalid : "",
      ].join(" ")}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span
        className={[
          fileBrowserStyles.inlineFields,
          props.variant === "grid" ? fileBrowserStyles.inlineFieldsGrid : "",
          props.edit.error ? fileBrowserStyles.inlineFieldsInvalid : "",
          props.edit.error && props.variant === "table" ? fileBrowserStyles.inlineFieldsInvalidTable : "",
        ].join(" ")}
      >
        <input
          className={fileBrowserStyles.inlineInput}
          ref={inputRef}
          aria-label={props.edit.kind === "create" ? "New item name" : "Rename item"}
          value={props.edit.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              props.onCommit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              props.onCancel();
            }
          }}
        />
        {props.edit.lockedExtension ? <span className={fileBrowserStyles.lockedExtension}>{props.edit.lockedExtension}</span> : null}
      </span>
      {props.edit.error ? (
        <span
          className={props.variant === "table"
            ? `${fileBrowserStyles.inlineError} ${fileBrowserStyles.inlineErrorTable}`
            : fileBrowserStyles.inlineError}
          title={props.edit.error}
        >
          {props.edit.error}
        </span>
      ) : null}
    </span>
  );
}

function PassiveRenameDraftView(props: { draft: PassiveRenameDraft }) {
  return (
    <span
      className={`${fileBrowserStyles.passiveDraft} ${props.draft.error ? fileBrowserStyles.passiveDraftInvalid : ""}`}
      title={props.draft.error ?? undefined}
    >
      <span className={fileBrowserStyles.passiveDraftText}>{props.draft.value || " "}</span>
      {props.draft.lockedExtension ? <small className={fileBrowserStyles.passiveDraftExtension}>{props.draft.lockedExtension}</small> : null}
      <i className={fileBrowserStyles.passiveDraftCaret} aria-hidden="true" />
    </span>
  );
}

function FileIcon(props: { entry: FileEntry; size?: number; variant?: "table" | "grid" }) {
  const size = props.size ?? (props.variant === "table" ? 22 : 18);
  if (props.entry.isDeleted) return <Trash2 size={size} className={fileBrowserStyles.deletedIcon} />;
  if (props.entry.kind === "folder") return <Folder size={size} className={fileBrowserStyles.folderIcon} />;

  const iconKind = fileIconKind(props.entry);
  const className = fileIconClass(iconKind);
  switch (iconKind) {
    case "archive":
      return <FileArchive size={size} className={className} />;
    case "audio":
      return <FileAudio size={size} className={className} />;
    case "code":
      return <FileCode2 size={size} className={className} />;
    case "image":
      return <Image size={size} className={className} />;
    case "json":
      return <FileJson size={size} className={className} />;
    case "spreadsheet":
      return <FileSpreadsheet size={size} className={className} />;
    case "text":
      return <FileText size={size} className={className} />;
    case "video":
      return <FileVideo size={size} className={className} />;
    default:
      return <File size={size} className={className} />;
  }
}

type FileIconKind = "archive" | "audio" | "code" | "file" | "image" | "json" | "spreadsheet" | "text" | "video";

function fileIconClass(kind: FileIconKind): string {
  switch (kind) {
    case "archive":
      return fileBrowserStyles.iconArchive;
    case "audio":
      return fileBrowserStyles.iconAudio;
    case "code":
    case "json":
      return fileBrowserStyles.iconCode;
    case "image":
      return fileBrowserStyles.iconImage;
    case "spreadsheet":
      return fileBrowserStyles.iconSpreadsheet;
    case "text":
      return fileBrowserStyles.iconText;
    case "video":
      return fileBrowserStyles.iconVideo;
    default:
      return fileBrowserStyles.fileIcon;
  }
}

const archiveExtensions = new Set(["7z", "bz2", "dmg", "gz", "pkg", "rar", "tar", "tgz", "xz", "zip"]);
const audioExtensions = new Set(["aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav"]);
const codeExtensions = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "mjs",
  "rs",
  "sh",
  "swift",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const imageExtensions = new Set(["bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);
const jsonExtensions = new Set(["json", "jsonc", "lock"]);
const spreadsheetExtensions = new Set(["csv", "numbers", "ods", "tsv", "xls", "xlsm", "xlsx"]);
const textExtensions = new Set(["doc", "docx", "log", "md", "pdf", "rtf", "txt"]);
const videoExtensions = new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm"]);

function fileIconKind(entry: FileEntry): FileIconKind {
  const extension = entry.extension.replace(/^\./, "").toLowerCase();
  const mimeType = (entry.mimeType ?? "").toLowerCase();

  if (mimeType.startsWith("image/") || imageExtensions.has(extension)) return "image";
  if (mimeType.startsWith("video/") || videoExtensions.has(extension)) return "video";
  if (mimeType.startsWith("audio/") || audioExtensions.has(extension)) return "audio";
  if (mimeType.includes("json") || jsonExtensions.has(extension)) return "json";
  if (spreadsheetExtensions.has(extension)) return "spreadsheet";
  if (archiveExtensions.has(extension)) return "archive";
  if (mimeType.startsWith("text/") || codeExtensions.has(extension)) return "code";
  if (textExtensions.has(extension)) return "text";
  return "file";
}

function entryMatchesQuery(entry: FileEntry, query: string): boolean {
  const haystack = [
    entry.name,
    entry.extension,
    entry.mimeType ?? "",
    entry.kind,
    entry.location.remoteName ?? "",
    entry.location.providerType ?? "",
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function isMistyFileDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes("application/x-misty-files");
}

function isExternalFileDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

function passiveRenameDraftsFor(edit: ExplorerInlineEditState | null, paneId: string): Map<string, PassiveRenameDraft> {
  const drafts = new Map<string, PassiveRenameDraft>();
  if (edit?.kind !== "rename" || !edit.batchItems || edit.batchItems.length <= 1) return drafts;
  for (const item of edit.batchItems) {
    if (item.paneId !== paneId || (item.paneId === edit.paneId && item.entryId === edit.entryId)) continue;
    drafts.set(item.entryId, {
      value: item.value,
      lockedExtension: item.lockedExtension,
      error: item.error,
    });
  }
  return drafts;
}

function loadColumnWidths(): FileTableColumnWidths {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TABLE_COLUMN_STORAGE_KEY) ?? "{}") as Partial<FileTableColumnWidths>;
    return {
      name: validColumnWidth(parsed.name, defaultColumnWidths.name, minimumColumnWidths.name),
      modified: validColumnWidth(parsed.modified, defaultColumnWidths.modified, minimumColumnWidths.modified),
      size: validColumnWidth(parsed.size, defaultColumnWidths.size, minimumColumnWidths.size),
      type: validColumnWidth(parsed.type, defaultColumnWidths.type, minimumColumnWidths.type),
    };
  } catch {
    return { ...defaultColumnWidths };
  }
}

function saveColumnWidths(widths: FileTableColumnWidths): void {
  window.localStorage.setItem(TABLE_COLUMN_STORAGE_KEY, JSON.stringify(widths));
}

function validColumnWidth(value: unknown, fallback: number, minimum: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function loadColumnOrder(): FileTableColumn[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TABLE_COLUMN_ORDER_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [...fileTableColumns];
    const unique = parsed.filter(isFileTableColumn).filter((column, index, order) => order.indexOf(column) === index);
    const missing = fileTableColumns.filter((column) => !unique.includes(column));
    return unique.length > 0 ? [...unique, ...missing] : [...fileTableColumns];
  } catch {
    return [...fileTableColumns];
  }
}

function saveColumnOrder(order: FileTableColumn[]): void {
  window.localStorage.setItem(TABLE_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(order));
}

function isFileTableColumn(value: unknown): value is FileTableColumn {
  return value === "name" || value === "modified" || value === "size" || value === "type";
}
