import type { DirectoryListing } from "@/native/ipc";
import {
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";
import { RotateCcw } from "lucide-react";
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileListProps } from "./FileList";
import { FileListRow } from "./FileListRow";
import {
  clampColumnWidth,
  clearColumnWidths,
  defaultColumnWidths,
  fileListColumnLabels,
  fileListColumns,
  loadColumnWidths,
  maximumColumnWidths,
  minimumColumnWidths,
  saveColumnWidths,
  type FileListColumn,
  type FileListColumnWidths,
} from "./fileListColumns";
import { fileListStyles } from "./fileListStyles";
import { SortableHeader } from "./SortableHeader";

const TABLE_OVERSCAN_ROWS = 4;
const ROW_HEIGHT = 50;
const ICON_SIZE = 20;
const columnOrder = fileListColumns;

/**
 * The picker's list of files.
 *
 * Rows are windowed against the scroll container rather than rendered whole,
 * so a directory with tens of thousands of entries still scrolls smoothly.
 */
export function FileListTable(props: FileListProps & { listing: DirectoryListing }) {
  const headerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const viewportHeightRef = useRef(0);
  const viewportWidthRef = useRef(0);
  const scrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [columnWidths, setColumnWidths] = useState<FileListColumnWidths>(loadColumnWidths);
  const [resizingColumn, setResizingColumn] = useState<FileListColumn | null>(null);
  const selectedIds = useMemo(() => new Set(props.selectedIds), [props.selectedIds]);
  const visibleEntryIds = useMemo(
    () => props.listing.entries.map((entry) => entry.id),
    [props.listing.entries],
  );
  const rowCount = props.listing.entries.length;
  const tableWidth = columnOrder.reduce((sum, column) => sum + columnWidths[column], 0);
  const fillerColumnWidth = Math.max(0, viewportWidth - tableWidth);
  const hasFillerColumn = fillerColumnWidth >= 1;
  const renderedTableWidth = tableWidth + fillerColumnWidth;
  const tableColumnCount = columnOrder.length + (hasFillerColumn ? 1 : 0);
  const visibleCapacity = Math.max(1, Math.ceil(viewportHeight / ROW_HEIGHT));
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - TABLE_OVERSCAN_ROWS);
  const endIndex = Math.min(rowCount, startIndex + visibleCapacity + TABLE_OVERSCAN_ROWS * 2);
  const visibleEntries = props.listing.entries.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (rowCount - endIndex) * ROW_HEIGHT);
  const columnsDirty = useMemo(
    () => fileListColumns.some((column) => columnWidths[column] !== defaultColumnWidths[column]),
    [columnWidths],
  );

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

  const beginColumnResize = useCallback(
    (column: FileListColumn, event: ReactPointerEvent) => {
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
        setColumnWidths((current) =>
          current[column] === pendingWidth ? current : { ...current, [column]: pendingWidth },
        );
      };
      const onPointerMove = (moveEvent: PointerEvent) => {
        pendingWidth = clampColumnWidth(
          startWidth + moveEvent.clientX - startX,
          minimumColumnWidths[column],
          maximumColumnWidths[column],
        );
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
    },
    [columnWidths],
  );

  const resetColumnWidths = useCallback(() => {
    setColumnWidths({ ...defaultColumnWidths });
    clearColumnWidths();
  }, []);

  const handleSelect = useCallback(
    (entryId: string, event: MouseEvent) => props.onSelect(entryId, event, visibleEntryIds),
    [props, visibleEntryIds],
  );

  const columns = (
    <colgroup>
      {columnOrder.map((column) => (
        <col key={column} style={{ width: columnWidths[column] }} />
      ))}
      {hasFillerColumn ? <col style={{ width: fillerColumnWidth }} /> : null}
    </colgroup>
  );
  return (
    <div className={`${fileListStyles.tableWrap} relative`}>
      {columnsDirty ? (
        <IconButton
          size="xs"
          tooltip={false}
          className={fileListStyles.tableResetButton}
          title="Reset columns"
          label="Reset table columns"
          onClick={resetColumnWidths}
        >
          <RotateCcw size={14} />
        </IconButton>
      ) : null}
      <div ref={headerRef} className={fileListStyles.tableHeaderWrap}>
        <Table
          unwrapped
          className={fileListStyles.table}
          style={{ width: renderedTableWidth, minWidth: renderedTableWidth }}
        >
          {columns}
          <TableHeader>
            <TableRow>
              {columnOrder.map((column) => (
                <SortableHeader
                  key={column}
                  label={fileListColumnLabels[column]}
                  column={column}
                  sort={props.sort}
                  resizing={resizingColumn === column}
                  onSort={props.onSort}
                  onResizeStart={beginColumnResize}
                />
              ))}
              {hasFillerColumn ? (
                <TableHead className={fileListStyles.tableHeadFiller} aria-hidden="true" />
              ) : null}
            </TableRow>
          </TableHeader>
        </Table>
      </div>
      <div
        ref={scrollRef}
        className={fileListStyles.tableScroll}
        onScroll={handleScroll}
        data-explorer-scroll-container
      >
        <Table
          unwrapped
          className={fileListStyles.table}
          style={{ width: renderedTableWidth, minWidth: renderedTableWidth }}
        >
          {columns}
          <TableBody>
            {topSpacerHeight > 0 ? (
              <TableRow aria-hidden="true" className="border-0">
                <TableCell
                  colSpan={tableColumnCount}
                  style={{ height: topSpacerHeight, padding: 0 }}
                />
              </TableRow>
            ) : null}
            {visibleEntries.map((entry) => (
              <FileListRow
                key={entry.id}
                entry={entry}
                columns={columnOrder}
                hasFillerColumn={hasFillerColumn}
                selected={selectedIds.has(entry.id)}
                rowHeight={ROW_HEIGHT}
                iconSize={ICON_SIZE}
                onSelect={handleSelect}
                onOpen={props.onOpen}
              />
            ))}
            {bottomSpacerHeight > 0 ? (
              <TableRow aria-hidden="true" className="border-0">
                <TableCell
                  colSpan={tableColumnCount}
                  style={{ height: bottomSpacerHeight, padding: 0 }}
                />
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
