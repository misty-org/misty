import {
  ChevronDown,
  ChevronUp,
  File,
  Folder,
  Download,
  RotateCcw,
} from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { explorerGenerateImageThumbnail } from "../../../api/misty";
import type { DirectoryListing, DirectorySizeRecord, FileEntry, FileSyncEndpoint, FileSyncPair } from "../../../api/types";
import { safeTauriAssetUrl } from "../../../shared/tauri";
import { selectAppearancePreferences, useSettingsStore } from "../../../stores/useSettingsStore";
import { directorySizeRecordForPath, entrySizeBytes } from "../../../stores/useExplorerStore";
import type {
  ExplorerCommandQueryMode,
  ExplorerInlineEditState,
  ExplorerSortColumn,
  ExplorerSortState,
  ExplorerViewMode,
} from "../../../stores/useExplorerStore";
import { useFileSyncStore } from "../../../stores/useFileSyncStore";
import { formatBytes, formatDate } from "../utils/fileFormat";
import {
  dragItemsForEntry,
  transferDropAcceptance,
} from "./FileBrowserDrag";
import type { FileBrowserDragItem } from "./FileBrowserDrag";
import { storageIdForPath } from "../drag/operations";
import { useExplorerDragSource, useExplorerDropZone } from "../drag/ExplorerDragContext";
import type { ExplorerDragModifiers, ExplorerDragPayload } from "../drag/types";
import { compileEntryFilterMatcher, entryMatchesQuery } from "./FileBrowserFilters";
import { FileIcon } from "./FileBrowserIcons";
import { InlineCreateTableRow, InlineNameEditor, PassiveRenameDraftView } from "./FileBrowserInline";
import type { PassiveRenameDraft } from "./FileBrowserInline";
import { FileBrowserSkeleton } from "./FileBrowserSkeleton";
import { fileBrowserStyles } from "./FileBrowserStyles";

const TABLE_ROW_HEIGHT = 44;
const TABLE_OVERSCAN_ROWS = 4;
const GRID_MIN_ITEM_WIDTH = 100;
const GRID_ITEM_HEIGHT = 104;
const GRID_GAP = 8;
const GRID_PADDING = 14;
const GRID_OVERSCAN_ROWS = 2;
const GRID_THUMBNAIL_MAX_DIMENSION = 384;
const MAX_CONCURRENT_GRID_THUMBNAILS = 3;
const TABLE_COLUMN_STORAGE_KEY = "misty.explorer.fileTable.columnWidths";
const TABLE_COLUMN_ORDER_STORAGE_KEY = "misty.explorer.fileTable.columnOrder";
const emptyEntries: FileEntry[] = [];

type FileTableColumn = ExplorerSortColumn;
type FileTableColumnWidths = Record<FileTableColumn, number>;

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

const maximumColumnWidths: FileTableColumnWidths = {
  name: 640,
  modified: 360,
  size: 220,
  type: 260,
};

interface FileBrowserProps {
  paneId: string;
  selectionOnly?: boolean;
  listing: DirectoryListing | null;
  selectedIds: string[];
  loading: boolean;
  error: string | null;
  viewMode: ExplorerViewMode;
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
  onDownload: (entry: FileEntry) => void;
  onContextMenu: (event: MouseEvent, entry: FileEntry) => void;
  onBackgroundContextMenu: (event: MouseEvent) => void;
  onDropItems: (payload: ExplorerDragPayload, destination: string, destinationStorageId: string, modifiers: ExplorerDragModifiers) => void;
  onInlineEditChange: (value: string) => void;
  onInlineEditCommit: () => void;
  onInlineEditCancel: () => void;
}

export type { FileBrowserDragItem } from "./FileBrowserDrag";

export const FileBrowser = memo(function FileBrowser(props: FileBrowserProps) {
  const deferredCommandQuery = useDeferredValue(props.commandQuery);
  const trimmedCommandQuery = deferredCommandQuery.trim();
  const filterMatcher = useMemo(
    () => props.commandQueryMode === "filter" && !trimmedCommandQuery.startsWith(">")
      ? compileEntryFilterMatcher(trimmedCommandQuery)
      : null,
    [props.commandQueryMode, trimmedCommandQuery],
  );
  const sourceEntries = props.listing?.entries ?? emptyEntries;
  const entries = useMemo(
    () => filterMatcher ? sourceEntries.filter((entry) => entryMatchesQuery(entry, filterMatcher)) : sourceEntries,
    [filterMatcher, sourceEntries],
  );
  const syncLabel = usePaneSyncStatus(props.listing);
  const thumbnailPreviewsEnabled = useSettingsStore((state) =>
    selectAppearancePreferences(state.settings?.document).thumbnailPreviewsEnabled,
  );
  const paneDropSpec = useMemo(() => {
    const destination = props.listing?.path ?? "";
    return {
      id: `pane:${props.paneId}`,
      accepts: (payload: ExplorerDragPayload) => destination
        ? transferDropAcceptance(payload, destination)
        : { valid: false, label: "Unavailable" },
      onDrop: (payload: ExplorerDragPayload, modifiers: ExplorerDragModifiers) => {
        if (!props.listing) return;
        props.onDropItems(
          payload,
          props.listing.path,
          storageIdForPath(props.listing.path, props.listing.location.remoteName),
          modifiers,
        );
      },
    };
  }, [props.listing, props.onDropItems, props.paneId]);
  const paneDrop = useExplorerDropZone(paneDropSpec);

  useEffect(() => {
    if (!thumbnailPreviewsEnabled || !props.listing) return;
    prewarmGridThumbnails(sourceEntries);
  }, [props.listing, sourceEntries, thumbnailPreviewsEnabled]);

  if (props.error) {
    return <div className={`${fileBrowserStyles.empty} ${fileBrowserStyles.emptyError}`}>{props.error}</div>;
  }
  if (props.loading) {
    return <FileBrowserSkeleton viewMode={props.viewMode} />;
  }
  if (!props.listing) {
    return <div className={fileBrowserStyles.empty}>Choose a location to begin.</div>;
  }

  const queryActive = Boolean(filterMatcher);
  const displayListing = entries === props.listing.entries ? props.listing : { ...props.listing, entries };
  const selectedEntries = selectedEntriesForListing(props.listing.entries, props.selectedIds);
  const selectedBytes = selectedEntries.reduce((sum, entry) => sum + (entrySizeBytes(entry, props.directorySizes) ?? 0), 0);
  const selectionLabel = selectedEntries.length > 0
    ? `${selectedEntries.length} selected${selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ""}`
    : (queryActive ? `${entries.length} of ${props.listing.totalCount} items` : `${props.listing.totalCount} items`);
  const locationLabel = locationStatusLabel(props.listing);

  return (
    <section
      ref={paneDrop.ref}
      className={fileBrowserStyles.browser}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClearSelection();
      }}
      onContextMenu={props.selectionOnly ? (event) => event.preventDefault() : props.onBackgroundContextMenu}
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

function selectedEntriesForListing(entries: FileEntry[], selectedIds: string[]): FileEntry[] {
  if (selectedIds.length === 0) return [];
  if (selectedIds.length === 1) {
    const entry = entries.find((candidate) => candidate.id === selectedIds[0] && !candidate.isDeleted);
    return entry ? [entry] : [];
  }
  const selected = new Set(selectedIds);
  return entries.filter((entry) => selected.has(entry.id) && !entry.isDeleted);
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
  const [columnOrder] = useState<FileTableColumn[]>(loadColumnOrder);
  const [resizingColumn, setResizingColumn] = useState<FileTableColumn | null>(null);
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
  const columnsDirty = useMemo(() => fileTableColumns.some((column) => columnWidths[column] !== defaultColumnWidths[column]), [columnWidths]);

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
    setResizingColumn(column);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    let pendingWidth = startWidth;
    let frame: number | null = null;
    const applyWidth = () => {
      frame = null;
      setColumnWidths((current) => current[column] === pendingWidth ? current : { ...current, [column]: pendingWidth });
    };
    const onPointerMove = (moveEvent: PointerEvent) => {
      pendingWidth = clampColumnWidth(startWidth + moveEvent.clientX - startX, minimumColumnWidths[column], maximumColumnWidths[column]);
      if (frame === null) frame = window.requestAnimationFrame(applyWidth);
    };
    const onPointerUp = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      const next = { ...columnWidths, [column]: pendingWidth };
      setColumnWidths(next);
      saveColumnWidths(next);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setResizingColumn(null);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }, [columnWidths]);

  const resetColumnWidths = useCallback(() => {
    const next = { ...defaultColumnWidths };
    setColumnWidths(next);
    window.localStorage.removeItem(TABLE_COLUMN_STORAGE_KEY);
  }, []);

  const handleSelect = useCallback(
    (entryId: string, event: MouseEvent) => props.onSelect(entryId, event, visibleEntryIds),
    [props.onSelect, visibleEntryIds],
  );

  return (
    <div className={`${fileBrowserStyles.tableWrap} relative`}>
      {columnsDirty ? (
        <button
          type="button"
          className={fileBrowserStyles.tableResetButton}
          title="Reset columns"
          aria-label="Reset table columns"
          onClick={resetColumnWidths}
        >
          <RotateCcw size={14} />
        </button>
      ) : null}
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
                  resizing={resizingColumn === column}
                  onSort={props.onSort}
                  onResizeStart={beginColumnResize}
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
        data-explorer-scroll-container
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
                selectionOnly={props.selectionOnly === true}
                columns={columnOrder}
                hasFillerColumn={hasFillerColumn}
                selected={selectedIds.has(entry.id)}
                cut={props.cutPaths.has(entry.path)}
                onSelect={handleSelect}
                onOpen={props.onOpen}
                onDownload={props.onDownload}
                onContextMenu={props.onContextMenu}
                dragItems={dragItemsForEntry(entry, props.listing.entries, selectedIds)}
                onDropItems={props.onDropItems}
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
  resizing: boolean;
  onSort: (column: FileTableColumn) => void;
  onResizeStart: (column: FileTableColumn, event: ReactPointerEvent) => void;
}) {
  const active = props.sort.column === props.column;
  const direction = active ? props.sort.direction : null;
  return (
    <th
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={`${fileBrowserStyles.tableHeadCell} ${props.column === "size" ? fileBrowserStyles.tableNumericHeader : ""}`}
    >
      <button className={`${fileBrowserStyles.tableSort} ${active ? fileBrowserStyles.tableSortActive : ""}`} onClick={() => props.onSort(props.column)}>
        <span className={fileBrowserStyles.tableSortLabel}>{props.label}</span>
        <span className={fileBrowserStyles.tableSortIndicator}>
          {active ? (direction === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : null}
        </span>
      </button>
      <span
        className={`${fileBrowserStyles.tableResizeHandle} ${props.resizing ? fileBrowserStyles.tableResizeHandleActive : ""}`}
        aria-hidden="true"
        onPointerDown={(event) => props.onResizeStart(props.column, event)}
      />
    </th>
  );
});

const FileTableRow = memo(function FileTableRow(props: {
  entry: FileEntry;
  selectionOnly: boolean;
  columns: FileTableColumn[];
  hasFillerColumn: boolean;
  selected: boolean;
  cut: boolean;
  onSelect: (entryId: string, event: MouseEvent) => void;
  onOpen: FileBrowserProps["onOpen"];
  onDownload: FileBrowserProps["onDownload"];
  onContextMenu: FileBrowserProps["onContextMenu"];
  dragItems: FileBrowserDragItem[];
  onDropItems: FileBrowserProps["onDropItems"];
  inlineEdit: ExplorerInlineEditState | null;
  passiveRename: PassiveRenameDraft | null;
  directorySizes: Record<string, DirectorySizeRecord>;
  onInlineEditChange: FileBrowserProps["onInlineEditChange"];
  onInlineEditCommit: FileBrowserProps["onInlineEditCommit"];
  onInlineEditCancel: FileBrowserProps["onInlineEditCancel"];
}) {
  const { entry } = props;
  const source = useExplorerDragSource(props.selectionOnly || entry.isDeleted ? [] : props.dragItems);
  const dropSpec = useMemo(() => ({
    id: `entry:${entry.id}`,
    priority: 20,
    accepts: (payload: ExplorerDragPayload) => transferDropAcceptance(payload, entry.path, {
      folder: entry.kind === "folder",
      writable: !entry.readonly && !entry.isDeleted,
    }),
    onDrop: (payload: ExplorerDragPayload, modifiers: ExplorerDragModifiers) => props.onDropItems(
      payload,
      entry.path,
      storageIdForPath(entry.path, entry.location.remoteName),
      modifiers,
    ),
    onSpringLoad: entry.kind === "folder" ? () => props.onOpen(entry) : undefined,
    springLoad: entry.kind === "folder",
  }), [entry, props.onDropItems, props.onOpen]);
  const drop = useExplorerDropZone(dropSpec);

  return (
    <tr
      ref={drop.ref}
      className={`${fileBrowserStyles.tableRow} ${props.selected ? fileBrowserStyles.tableRowSelected : ""} ${props.inlineEdit ? fileBrowserStyles.tableRowInlineEditing : ""} ${entry.isDeleted ? fileBrowserStyles.tableRowDeleted : ""} ${source.dragging ? fileBrowserStyles.tableRowDragging : ""} ${props.cut ? fileBrowserStyles.tableRowCut : ""}`}
      aria-disabled={entry.isDeleted || undefined}
      aria-selected={props.selected}
      tabIndex={entry.isDeleted ? -1 : 0}
      onPointerDown={source.onPointerDown}
      onClick={(event) => props.onSelect(entry.id, event)}
      onDoubleClick={() => {
        if (!entry.isDeleted) props.onOpen(entry);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !entry.isDeleted) props.onOpen(entry);
      }}
      onContextMenu={props.selectionOnly ? (event) => event.preventDefault() : (event) => props.onContextMenu(event, entry)}
    >
      {props.columns.map((column) => (
        <FileTableCell
          key={column}
          column={column}
          entry={entry}
          showDownload={!props.selectionOnly}
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
  showDownload: boolean;
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
      return <td className={`${fileBrowserStyles.tableCell} ${fileBrowserStyles.tableDateCell}`}>{formatDate(props.entry.remoteModified ?? props.entry.modifiedMs)}</td>;
    case "size":
      return <td className={`${fileBrowserStyles.tableCell} ${fileBrowserStyles.tableNumericCell}`}>{formatEntrySize(props.entry, props.directorySizes)}</td>;
    case "type":
      if (props.entry.isDeleted) return <td className={fileBrowserStyles.tableCell}>Deleted</td>;
      return (
        <td className={fileBrowserStyles.tableCell}>
          <span>{props.entry.kind === "folder" ? "Folder" : props.entry.mimeType || props.entry.extension || props.entry.kind}</span>
          {props.showDownload && isDownloadableRemoteFile(props.entry) ? (
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
  const thumbnailPreviewsEnabled = useSettingsStore((state) =>
    selectAppearancePreferences(state.settings?.document).thumbnailPreviewsEnabled,
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
    <div
      ref={scrollRef}
      className={fileBrowserStyles.gridScroll}
      onScroll={handleScroll}
      data-explorer-scroll-container
    >
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
                selectionOnly={props.selectionOnly === true}
                thumbnailsEnabled={thumbnailPreviewsEnabled}
                selected={selectedIds.has(item.entry.id)}
                cut={props.cutPaths.has(item.entry.path)}
                inlineEdit={activeInlineEdit?.entryId === item.entry.id ? activeInlineEdit : null}
                passiveRename={passiveRenameDrafts.get(item.entry.id) ?? null}
                onSelect={handleSelect}
                onOpen={props.onOpen}
                onDownload={props.onDownload}
                onContextMenu={props.onContextMenu}
                dragItems={dragItemsForEntry(item.entry, props.listing.entries, selectedIds)}
                onDropItems={props.onDropItems}
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
  selectionOnly: boolean;
  thumbnailsEnabled: boolean;
  selected: boolean;
  cut: boolean;
  inlineEdit: ExplorerInlineEditState | null;
  passiveRename: PassiveRenameDraft | null;
  onSelect: (entryId: string, event: MouseEvent) => void;
  onOpen: FileBrowserProps["onOpen"];
  onDownload: FileBrowserProps["onDownload"];
  onContextMenu: FileBrowserProps["onContextMenu"];
  dragItems: FileBrowserDragItem[];
  onDropItems: FileBrowserProps["onDropItems"];
  onInlineEditChange: FileBrowserProps["onInlineEditChange"];
  onInlineEditCommit: FileBrowserProps["onInlineEditCommit"];
  onInlineEditCancel: FileBrowserProps["onInlineEditCancel"];
}) {
  const { entry } = props;
  const source = useExplorerDragSource(props.selectionOnly || entry.isDeleted ? [] : props.dragItems);
  const dropSpec = useMemo(() => ({
    id: `entry:${entry.id}`,
    priority: 20,
    accepts: (payload: ExplorerDragPayload) => transferDropAcceptance(payload, entry.path, {
      folder: entry.kind === "folder",
      writable: !entry.readonly && !entry.isDeleted,
    }),
    onDrop: (payload: ExplorerDragPayload, modifiers: ExplorerDragModifiers) => props.onDropItems(
      payload,
      entry.path,
      storageIdForPath(entry.path, entry.location.remoteName),
      modifiers,
    ),
    onSpringLoad: entry.kind === "folder" ? () => props.onOpen(entry) : undefined,
    springLoad: entry.kind === "folder",
  }), [entry, props.onDropItems, props.onOpen]);
  const drop = useExplorerDropZone(dropSpec);

  return (
    <div
      ref={drop.ref}
      className={`${fileBrowserStyles.gridItem} ${props.selected ? fileBrowserStyles.gridItemSelected : ""} ${entry.isDeleted ? fileBrowserStyles.gridItemDeleted : ""} ${source.dragging ? fileBrowserStyles.gridItemDragging : ""} ${props.cut ? fileBrowserStyles.gridItemCut : ""}`}
      aria-disabled={entry.isDeleted || undefined}
      aria-pressed={props.selected}
      role="button"
      tabIndex={entry.isDeleted ? -1 : 0}
      onPointerDown={source.onPointerDown}
      onClick={(event) => props.onSelect(entry.id, event)}
      onDoubleClick={() => {
        if (!entry.isDeleted) props.onOpen(entry);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !entry.isDeleted) props.onOpen(entry);
      }}
      onContextMenu={props.selectionOnly ? (event) => event.preventDefault() : (event) => props.onContextMenu(event, entry)}
    >
      {!props.selectionOnly && isDownloadableRemoteFile(entry) ? (
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
      <GridThumbnail entry={entry} enabled={props.thumbnailsEnabled} />
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

function GridThumbnail(props: { entry: FileEntry; enabled: boolean }) {
  const { thumbnailUrl } = useGridThumbnailUrl(props.entry, props.enabled);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [thumbnailUrl, props.entry.id, props.entry.path]);

  if (thumbnailUrl && !failed) {
    return (
      <span className={fileBrowserStyles.gridThumb}>
        <img
          className={fileBrowserStyles.gridThumbImage}
          src={thumbnailUrl}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className={fileBrowserStyles.gridThumbIcon}>
      <FileIcon entry={props.entry} size={32} />
    </span>
  );
}

function useGridThumbnailUrl(entry: FileEntry, enabled: boolean): {
  thumbnailUrl: string | null;
} {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    setThumbnailUrl(null);
    if (!enabled || !gridThumbnailSupported(entry)) return () => undefined;

    const cancelThumbnail = requestGridThumbnail(entry, GRID_THUMBNAIL_MAX_DIMENSION, setThumbnailUrl);
    return cancelThumbnail;
  }, [
    enabled,
    entry.extension,
    entry.id,
    entry.isDeleted,
    entry.kind,
    entry.location.kind,
    entry.mimeType,
    entry.modifiedMs,
    entry.path,
    entry.remoteModified,
    entry.sizeBytes,
  ]);

  return { thumbnailUrl };
}

const gridThumbnailImageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "tga",
  "hdr",
  "pic",
  "pbm",
  "pgm",
  "pnm",
  "ppm",
  "psd",
]);
const gridThumbnailUrlCache = new Map<string, string>();
const failedGridThumbnails = new Set<string>();
const gridThumbnailQueue: GridThumbnailJob[] = [];
const gridThumbnailJobs = new Map<string, GridThumbnailJob>();
let activeGridThumbnailJobs = 0;
let backgroundGridThumbnailTimer: number | null = null;

type GridThumbnailSubscriber = (url: string | null) => void;

interface GridThumbnailJob {
  key: string;
  entry: FileEntry;
  maxDimension: number;
  subscribers: Set<GridThumbnailSubscriber>;
  processing: boolean;
  background: boolean;
}

function gridThumbnailSupported(entry: FileEntry): boolean {
  if (entry.kind === "folder" || entry.kind === "symlink" || entry.isDeleted) return false;
  if (entry.location.kind === "remote_provider") return false;
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return gridThumbnailImageExtensions.has(extension);
}

function gridThumbnailCacheKey(entry: FileEntry, maxDimension: number): string {
  return [
    entry.path,
    entry.sizeBytes ?? "",
    entry.modifiedMs ?? "",
    entry.remoteModified ?? "",
    maxDimension,
  ].join("\0");
}

function prewarmGridThumbnails(entries: FileEntry[]): void {
  for (const entry of entries) {
    if (gridThumbnailSupported(entry)) enqueueGridThumbnail(entry, GRID_THUMBNAIL_MAX_DIMENSION, true);
  }
}

function enqueueGridThumbnail(
  entry: FileEntry,
  maxDimension: number,
  background: boolean,
): GridThumbnailJob | null {
  const key = gridThumbnailCacheKey(entry, maxDimension);
  if (gridThumbnailUrlCache.has(key) || failedGridThumbnails.has(key)) return null;

  let job = gridThumbnailJobs.get(key);
  if (job) {
    if (!background) {
      job.background = false;
      promoteGridThumbnailJob(job);
    }
    return job;
  }

  job = { key, entry, maxDimension, subscribers: new Set(), processing: false, background };
  gridThumbnailJobs.set(key, job);
  gridThumbnailQueue.push(job);
  if (background) {
    scheduleBackgroundGridThumbnailProcessing();
  } else {
    processNextGridThumbnail();
  }
  return job;
}

function requestGridThumbnail(
  entry: FileEntry,
  maxDimension: number,
  subscriber: GridThumbnailSubscriber,
): () => void {
  const key = gridThumbnailCacheKey(entry, maxDimension);
  const cached = gridThumbnailUrlCache.get(key);
  if (cached) {
    subscriber(cached);
    return () => undefined;
  }
  const job = enqueueGridThumbnail(entry, maxDimension, false);
  if (!job) return () => undefined;
  job.subscribers.add(subscriber);
  job.background = false;
  promoteGridThumbnailJob(job);

  return () => {
    job?.subscribers.delete(subscriber);
    if (job && job.subscribers.size === 0 && !job.processing && !job.background) {
      removeQueuedGridThumbnailJob(job);
      gridThumbnailJobs.delete(job.key);
    }
  };
}

function promoteGridThumbnailJob(job: GridThumbnailJob): void {
  if (job.processing) return;
  removeQueuedGridThumbnailJob(job);
  gridThumbnailQueue.unshift(job);
  processNextGridThumbnail();
}

function scheduleBackgroundGridThumbnailProcessing(): void {
  if (backgroundGridThumbnailTimer != null) return;
  backgroundGridThumbnailTimer = window.setTimeout(() => {
    backgroundGridThumbnailTimer = null;
    processNextGridThumbnail();
  }, 250);
}

function processNextGridThumbnail(): void {
  while (activeGridThumbnailJobs < MAX_CONCURRENT_GRID_THUMBNAILS) {
    const job = gridThumbnailQueue.shift();
    if (!job) return;
    if (gridThumbnailUrlCache.has(job.key) || failedGridThumbnails.has(job.key)) {
      gridThumbnailJobs.delete(job.key);
      continue;
    }
    job.processing = true;
    activeGridThumbnailJobs += 1;
    void explorerGenerateImageThumbnail(job.entry.path, job.maxDimension, {
      modifiedMs: job.entry.modifiedMs,
      remoteModified: job.entry.remoteModified,
      sizeBytes: job.entry.sizeBytes,
    })
      .then((payload) => {
        const url = safeTauriAssetUrl(payload.path);
        gridThumbnailUrlCache.set(job.key, url);
        for (const subscriber of job.subscribers) subscriber(url);
      })
      .catch(() => {
        failedGridThumbnails.add(job.key);
        for (const subscriber of job.subscribers) subscriber(null);
      })
      .finally(() => {
        job.processing = false;
        activeGridThumbnailJobs -= 1;
        gridThumbnailJobs.delete(job.key);
        processNextGridThumbnail();
      });
  }
}

function removeQueuedGridThumbnailJob(job: GridThumbnailJob): void {
  const index = gridThumbnailQueue.indexOf(job);
  if (index >= 0) gridThumbnailQueue.splice(index, 1);
}

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
      name: validColumnWidth(parsed.name, defaultColumnWidths.name, minimumColumnWidths.name, maximumColumnWidths.name),
      modified: validColumnWidth(parsed.modified, defaultColumnWidths.modified, minimumColumnWidths.modified, maximumColumnWidths.modified),
      size: validColumnWidth(parsed.size, defaultColumnWidths.size, minimumColumnWidths.size, maximumColumnWidths.size),
      type: validColumnWidth(parsed.type, defaultColumnWidths.type, minimumColumnWidths.type, maximumColumnWidths.type),
    };
  } catch {
    return { ...defaultColumnWidths };
  }
}

function saveColumnWidths(widths: FileTableColumnWidths): void {
  window.localStorage.setItem(TABLE_COLUMN_STORAGE_KEY, JSON.stringify(widths));
}

function validColumnWidth(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clampColumnWidth(value, minimum, maximum)
    : fallback;
}

function clampColumnWidth(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
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

function isFileTableColumn(value: unknown): value is FileTableColumn {
  return value === "name" || value === "modified" || value === "size" || value === "type";
}
