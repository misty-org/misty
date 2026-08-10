import type { DirectoryListing } from "@/services/misty/model/misty-api";
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui";
import { RotateCcw } from "lucide-react";
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileBrowserProps } from "../../model/interfaces/components/FileBrowser";
import type {
  FileTableColumn,
  FileTableColumnWidths,
} from "../../model/types/components/FileBrowser";
import type { ExplorerSortColumn } from "../../store";
import { dragItemsForEntry } from "../FileBrowserDrag";
import { InlineCreateTableRow } from "../FileBrowserInline";
import { fileBrowserStyles } from "../FileBrowserStyles";
import {
  clampColumnWidth,
  clearColumnWidths,
  loadColumnOrder,
  loadColumnWidths,
  saveColumnWidths,
} from "./columnLayout";
import { passiveRenameDraftsFor } from "./entryPresentation";
import {
  TABLE_OVERSCAN_ROWS,
  defaultColumnWidths,
  fileTableColumnLabels,
  fileTableColumns,
  maximumColumnWidths,
  minimumColumnWidths,
  normalizeItemScale,
} from "./fileTableConfig";
import { FileTableRow } from "./FileTableRow";
import { SortableHeader } from "./SortableHeader";

/**
 * The Explorer's list view.
 *
 * Rows are windowed against the scroll container rather than rendered whole,
 * so a directory with tens of thousands of entries still scrolls smoothly.
 */
export function FileTable(props: FileBrowserProps & { listing: DirectoryListing }) {
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
  const visibleEntryIds = useMemo(
    () => props.listing.entries.map((entry) => entry.id),
    [props.listing.entries],
  );
  const passiveRenameDrafts = useMemo(
    () => passiveRenameDraftsFor(props.inlineEdit, props.paneId),
    [props.inlineEdit, props.paneId],
  );
  const activeInlineEdit = props.inlineEdit?.paneId === props.paneId ? props.inlineEdit : null;
  const itemScale = normalizeItemScale(props.itemScale);
  const rowHeight = 42 + itemScale * 8;
  const tableIconSize = 19 + itemScale * 4;
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
  const columnsDirty = useMemo(
    () => fileTableColumns.some((column) => columnWidths[column] !== defaultColumnWidths[column]),
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
  }, [props.inlineEdit, props.listing.entries, rowHeight]);

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
    (column: ExplorerSortColumn, event: ReactPointerEvent) => {
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
    const next = { ...defaultColumnWidths };
    setColumnWidths(next);
    clearColumnWidths();
  }, []);

  const handleSelect = useCallback(
    (entryId: string, event: MouseEvent) => props.onSelect(entryId, event, visibleEntryIds),
    [props, visibleEntryIds],
  );

  return (
    <div className={`${fileBrowserStyles.tableWrap} relative`}>
      {columnsDirty ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={fileBrowserStyles.tableResetButton}
          title="Reset columns"
          aria-label="Reset table columns"
          onClick={resetColumnWidths}
        >
          <RotateCcw size={14} />
        </Button>
      ) : null}
      <div ref={headerRef} className={fileBrowserStyles.tableHeaderWrap}>
        <Table
          unwrapped
          className={fileBrowserStyles.table}
          style={{ width: renderedTableWidth, minWidth: renderedTableWidth }}
        >
          <colgroup>
            {columnOrder.map((column) => (
              <col key={column} style={{ width: columnWidths[column] }} />
            ))}
            {hasFillerColumn ? <col style={{ width: fillerColumnWidth }} /> : null}
          </colgroup>
          <TableHeader>
            <TableRow>
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
              {hasFillerColumn ? (
                <TableHead className={fileBrowserStyles.tableHeadFiller} aria-hidden="true" />
              ) : null}
            </TableRow>
          </TableHeader>
        </Table>
      </div>
      <div
        ref={scrollRef}
        className={fileBrowserStyles.tableScroll}
        onScroll={handleScroll}
        data-explorer-scroll-container
      >
        <Table
          unwrapped
          className={fileBrowserStyles.table}
          style={{ width: renderedTableWidth, minWidth: renderedTableWidth }}
        >
          <colgroup>
            {columnOrder.map((column) => (
              <col key={column} style={{ width: columnWidths[column] }} />
            ))}
            {hasFillerColumn ? <col style={{ width: fillerColumnWidth }} /> : null}
          </colgroup>
          <TableBody>
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
            {topSpacerHeight > 0 ? (
              <TableRow aria-hidden="true" className="border-0">
                <TableCell
                  colSpan={tableColumnCount}
                  style={{ height: topSpacerHeight, padding: 0 }}
                />
              </TableRow>
            ) : null}
            {visibleEntries.map((entry) => (
              <FileTableRow
                key={entry.id}
                entry={entry}
                selectionOnly={props.selectionOnly === true}
                columns={columnOrder}
                hasFillerColumn={hasFillerColumn}
                selected={selectedIds.has(entry.id)}
                cut={props.cutPaths.has(entry.path)}
                rowHeight={rowHeight}
                iconSize={tableIconSize}
                onSelect={handleSelect}
                onOpen={props.onOpen}
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
