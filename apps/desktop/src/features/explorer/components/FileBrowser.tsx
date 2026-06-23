import {
  ChevronDown,
  ChevronUp,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Download,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { DirectoryListing, FileEntry } from "../../../api/types";
import { selectAppearancePreferences, useSettingsStore } from "../../settings/useSettingsStore";
import type {
  ExplorerInlineEditState,
  ExplorerSortColumn,
  ExplorerSortState,
  ExplorerViewMode,
} from "../state/useExplorerStore";
import { formatBytes, formatDate } from "../utils/fileFormat";

const TABLE_ROW_HEIGHT = 32;
const TABLE_OVERSCAN_ROWS = 10;
const GRID_MIN_ITEM_WIDTH = 100;
const GRID_ITEM_HEIGHT = 104;
const GRID_GAP = 8;
const GRID_PADDING = 14;
const GRID_OVERSCAN_ROWS = 4;
const TABLE_COLUMN_STORAGE_KEY = "misty.explorer.fileTable.columnWidths";
const TABLE_COLUMN_ORDER_STORAGE_KEY = "misty.explorer.fileTable.columnOrder";
const emptyEntries: FileEntry[] = [];

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
  commandQuery: string;
  inlineEdit: ExplorerInlineEditState | null;
  onSort: (column: ExplorerSortColumn) => void;
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

  if (props.error) {
    return <div className="explorer-empty error">{props.error}</div>;
  }
  if (props.loading) {
    return <FileBrowserSkeleton viewMode={props.viewMode} />;
  }
  if (!props.listing) {
    return <div className="explorer-empty">Choose a location to begin.</div>;
  }

  const queryActive = query.length > 0;
  const displayListing = entries === props.listing.entries ? props.listing : { ...props.listing, entries };
  const footerLabel = queryActive
    ? `${entries.length} of ${props.listing.totalCount} items (${props.listing.hiddenCount} hidden)`
    : `${props.listing.totalCount} items (${props.listing.hiddenCount} hidden)`;

  return (
    <section
      className="file-browser"
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
      <footer className="file-browser-footer">
        {footerLabel}
      </footer>
    </section>
  );
});

function FileBrowserSkeleton(props: { viewMode: ExplorerViewMode }) {
  const rows = Array.from({ length: 12 }, (_, index) => index);
  const tiles = Array.from({ length: 20 }, (_, index) => index);

  return (
    <section className="file-browser file-browser-loading" aria-busy="true" aria-label="Loading directory">
      {props.viewMode === "grid" ? (
        <div className="file-grid-skeleton" aria-hidden="true">
          {tiles.map((index) => <span key={index} />)}
        </div>
      ) : (
        <div className="file-table-skeleton" aria-hidden="true">
          <div className="file-table-skeleton-header">
            <span />
            <span />
            <span />
            <span />
          </div>
          {rows.map((index) => (
            <div className="file-table-skeleton-row" key={index}>
              <span />
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      )}
      <footer className="file-browser-footer">Loading directory...</footer>
    </section>
  );
}

function FileTable(props: FileBrowserProps & { listing: DirectoryListing }) {
  const compactModeEnabled = useSettingsStore((state) =>
    selectAppearancePreferences(state.settings?.document).compactModeEnabled,
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const viewportHeightRef = useRef(0);
  const scrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [columnWidths, setColumnWidths] = useState<FileTableColumnWidths>(loadColumnWidths);
  const [columnOrder, setColumnOrder] = useState<FileTableColumn[]>(loadColumnOrder);
  const [draggedColumn, setDraggedColumn] = useState<FileTableColumn | null>(null);
  const selectedIds = useMemo(() => new Set(props.selectedIds), [props.selectedIds]);
  const visibleEntryIds = useMemo(() => props.listing.entries.map((entry) => entry.id), [props.listing.entries]);
  const passiveRenameDrafts = useMemo(() => passiveRenameDraftsFor(props.inlineEdit, props.paneId), [props.inlineEdit, props.paneId]);
  const activeInlineEdit = props.inlineEdit?.paneId === props.paneId ? props.inlineEdit : null;
  const rowHeight = compactModeEnabled ? 28 : TABLE_ROW_HEIGHT;
  const rowCount = props.listing.entries.length;
  const tableWidth = columnOrder.reduce((sum, column) => sum + columnWidths[column], 0);
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
    <div
      ref={scrollRef}
      className="file-table-wrap"
      onScroll={handleScroll}
    >
      <table className="file-table" style={{ width: tableWidth, minWidth: "100%" }}>
        <colgroup>
          {columnOrder.map((column) => <col key={column} style={{ width: columnWidths[column] }} />)}
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
          </tr>
        </thead>
        <tbody>
          {props.inlineEdit?.kind === "create" ? (
            <InlineCreateTableRow
              edit={props.inlineEdit}
              columns={columnOrder}
              onChange={props.onInlineEditChange}
              onCommit={props.onInlineEditCommit}
              onCancel={props.onInlineEditCancel}
            />
          ) : null}
          {topSpacerHeight > 0 ? <tr aria-hidden="true"><td colSpan={columnOrder.length} style={{ height: topSpacerHeight, padding: 0 }} /></tr> : null}
          {visibleEntries.map((entry) => (
            <FileTableRow
              key={entry.id}
              entry={entry}
              columns={columnOrder}
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
              onInlineEditChange={props.onInlineEditChange}
              onInlineEditCommit={props.onInlineEditCommit}
              onInlineEditCancel={props.onInlineEditCancel}
            />
          ))}
          {bottomSpacerHeight > 0 ? <tr aria-hidden="true"><td colSpan={columnOrder.length} style={{ height: bottomSpacerHeight, padding: 0 }} /></tr> : null}
        </tbody>
      </table>
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
      className={props.dragging ? "dragging" : undefined}
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
      <button className={active ? "file-table-sort active" : "file-table-sort"} onClick={() => props.onSort(props.column)}>
        <span>{props.label}</span>
        <span className="file-table-sort-indicator">
          {active ? (direction === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : null}
        </span>
      </button>
      <span
        className="file-table-resize-handle"
        aria-hidden="true"
        onPointerDown={(event) => props.onResizeStart(props.column, event)}
      />
    </th>
  );
});

const FileTableRow = memo(function FileTableRow(props: {
  entry: FileEntry;
  columns: FileTableColumn[];
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
  onInlineEditChange: FileBrowserProps["onInlineEditChange"];
  onInlineEditCommit: FileBrowserProps["onInlineEditCommit"];
  onInlineEditCancel: FileBrowserProps["onInlineEditCancel"];
}) {
  const { entry } = props;
  return (
    <tr
      className={`${props.selected ? "selected" : ""}${props.inlineEdit ? " inline-editing" : ""}${entry.isDeleted ? " deleted" : ""}`}
      data-drop-destination={!entry.isDeleted && entry.kind === "folder" ? entry.path : undefined}
      data-drop-kind={!entry.isDeleted && entry.kind === "folder" ? "folder" : undefined}
      onClick={(event) => props.onSelect(entry.id, event, [])}
      onDoubleClick={() => {
        if (!entry.isDeleted) props.onOpen(entry);
      }}
      onContextMenu={(event) => props.onContextMenu(event, entry)}
      onPointerDown={() => {
        if (!entry.isDeleted) props.onPrepareDrag(entry);
      }}
      onFocus={() => {
        if (!entry.isDeleted) props.onPrepareDrag(entry);
      }}
      draggable={!props.inlineEdit && !entry.isDeleted}
      onDragStart={(event) => props.onDragStart(event, entry)}
      onDragEnd={props.onDragEnd}
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
          onDownload={props.onDownload}
          onInlineEditChange={props.onInlineEditChange}
          onInlineEditCommit={props.onInlineEditCommit}
          onInlineEditCancel={props.onInlineEditCancel}
        />
      ))}
    </tr>
  );
});

function FileTableCell(props: {
  column: FileTableColumn;
  entry: FileEntry;
  inlineEdit: ExplorerInlineEditState | null;
  passiveRename: PassiveRenameDraft | null;
  onDownload: FileBrowserProps["onDownload"];
  onInlineEditChange: FileBrowserProps["onInlineEditChange"];
  onInlineEditCommit: FileBrowserProps["onInlineEditCommit"];
  onInlineEditCancel: FileBrowserProps["onInlineEditCancel"];
}) {
  switch (props.column) {
    case "name":
      return (
        <td>
          <FileIcon entry={props.entry} />
          {props.inlineEdit ? (
            <InlineNameEditor
              edit={props.inlineEdit}
              onChange={props.onInlineEditChange}
              onCommit={props.onInlineEditCommit}
              onCancel={props.onInlineEditCancel}
            />
          ) : props.passiveRename ? (
            <PassiveRenameDraftView draft={props.passiveRename} />
          ) : <span>{props.entry.name}</span>}
        </td>
      );
    case "modified":
      return <td>{props.entry.remoteModified || formatDate(props.entry.modifiedMs)}</td>;
    case "size":
      return <td>{formatBytes(props.entry.sizeBytes)}</td>;
    case "type":
      if (props.entry.isDeleted) return <td>Deleted</td>;
      return (
        <td>
          <span>{props.entry.kind === "folder" ? "Folder" : props.entry.mimeType || props.entry.extension || props.entry.kind}</span>
          {isDownloadableRemoteFile(props.entry) ? (
            <button
              type="button"
              className="file-row-download"
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
    <div ref={scrollRef} className="file-grid-virtual-scroll" onScroll={handleScroll}>
      <div className="file-grid-virtual-sizer" style={{ height: totalHeight }}>
        <div
          className="file-grid"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, ${gridMinItemWidth}px))`,
            top: gridTop,
          }}
        >
          {visibleItems.map((item) => {
            if (item.kind === "create") {
              return (
                <div key={item.key} className="file-grid-item inline-edit selected">
                  {props.inlineEdit?.itemKind === "folder" ? <Folder size={32} className="folder-icon" /> : <File size={32} className="file-icon" />}
                  {props.inlineEdit ? (
                    <InlineNameEditor
                      edit={props.inlineEdit}
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
  return (
    <div
      className={`file-grid-item${props.selected ? " selected" : ""}${entry.isDeleted ? " deleted" : ""}`}
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
      onPointerDown={() => {
        if (!entry.isDeleted) props.onPrepareDrag(entry);
      }}
      onFocus={() => {
        if (!entry.isDeleted) props.onPrepareDrag(entry);
      }}
      draggable={!props.inlineEdit && !entry.isDeleted}
      onDragStart={(event) => props.onDragStart(event, entry)}
      onDragEnd={props.onDragEnd}
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
          className="file-grid-download"
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
          onChange={props.onInlineEditChange}
          onCommit={props.onInlineEditCommit}
          onCancel={props.onInlineEditCancel}
        />
      ) : props.passiveRename ? (
        <PassiveRenameDraftView draft={props.passiveRename} />
      ) : <span>{entry.name}</span>}
    </div>
  );
});

function isDownloadableRemoteFile(entry: FileEntry): boolean {
  return entry.location.kind === "remote" && entry.kind !== "folder" && !entry.isDeleted;
}

function InlineCreateTableRow(props: {
  edit: ExplorerInlineEditState;
  columns: FileTableColumn[];
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const entry = {
    kind: props.edit.itemKind === "folder" ? "folder" : "file",
  } as FileEntry;
  return (
    <tr className="selected inline-edit-row">
      {props.columns.map((column) => {
        if (column === "name") {
          return (
            <td key={column}>
              <FileIcon entry={entry} />
              <InlineNameEditor {...props} />
            </td>
          );
        }
        if (column === "type") return <td key={column}>{props.edit.itemKind === "folder" ? "Folder" : "File"}</td>;
        return <td key={column}>--</td>;
      })}
    </tr>
  );
}

function InlineNameEditor(props: {
  edit: ExplorerInlineEditState;
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
      className={`inline-name-editor${props.edit.error ? " invalid" : ""}`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="inline-name-fields">
        <input
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
        {props.edit.lockedExtension ? <span className="locked-extension">{props.edit.lockedExtension}</span> : null}
      </span>
      {props.edit.error ? <span className="inline-name-error" title={props.edit.error}>{props.edit.error}</span> : null}
    </span>
  );
}

function PassiveRenameDraftView(props: { draft: PassiveRenameDraft }) {
  return (
    <span className={`passive-rename-draft${props.draft.error ? " invalid" : ""}`} title={props.draft.error ?? undefined}>
      <span>{props.draft.value || " "}</span>
      {props.draft.lockedExtension ? <small>{props.draft.lockedExtension}</small> : null}
      <i aria-hidden="true" />
    </span>
  );
}

function FileIcon(props: { entry: FileEntry; size?: number }) {
  const size = props.size ?? 18;
  if (props.entry.isDeleted) return <Trash2 size={size} className="deleted-icon" />;
  if (props.entry.kind === "folder") return <Folder size={size} className="folder-icon" />;

  const iconKind = fileIconKind(props.entry);
  const className = `file-icon ${iconKind}-icon`;
  switch (iconKind) {
    case "archive":
      return <FileArchive size={size} className={className} />;
    case "audio":
      return <FileAudio size={size} className={className} />;
    case "code":
      return <FileCode2 size={size} className={className} />;
    case "image":
      return <FileImage size={size} className={className} />;
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
