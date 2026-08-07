import type { FileBrowserProps } from "@/models/interfaces/features/explorer/components/FileBrowser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { DirectoryListing, FileEntry } from "@/models/interfaces/services/misty-api";
import { selectAppearancePreferences, useSettingsStore } from "@/stores/app";
import { dragItemsForEntry } from "../FileBrowserDrag";
import { GenericFileIcon } from "../FileBrowserIcons";
import { InlineNameEditor } from "../FileBrowserInline";
import { fileBrowserStyles } from "../FileBrowserStyles";
import {
  GRID_GAP,
  GRID_ITEM_HEIGHT,
  GRID_OVERSCAN_ROWS,
  GRID_PADDING,
  GRID_SCROLLBAR_RESERVE,
  normalizeItemScale,
} from "./fileTableConfig";
import { passiveRenameDraftsFor } from "./entryPresentation";
import { FileGridItem } from "./FileGridItem";

/**
 * The Explorer's icon view.
 *
 * Rows are windowed like the table; thumbnails come from the shared queue in
 * , so scrolling always outranks background prewarming.
 */
export function FileGrid(props: FileBrowserProps & { listing: DirectoryListing }) {
  const compactModeEnabled = useSettingsStore(
    (state) => selectAppearancePreferences(state.settings?.document).compactModeEnabled,
  );
  const thumbnailPreviewsEnabled = useSettingsStore(
    (state) => selectAppearancePreferences(state.settings?.document).thumbnailPreviewsEnabled,
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
  const createOffset = props.inlineEdit?.kind === "create" ? 1 : 0;
  const itemCount = props.listing.entries.length + createOffset;
  const gridPadding = compactModeEnabled ? 2 : GRID_PADDING;
  const gridGap = compactModeEnabled ? 10 : GRID_GAP;
  const scrollbarReserve = GRID_SCROLLBAR_RESERVE;
  const usableWidth = Math.max(1, viewportWidth - gridPadding * 2 - scrollbarReserve);
  const desiredColumns = itemScale === 0 ? 6 : itemScale === 1 ? 5 : 4;
  const minimumColumnWidth = compactModeEnabled
    ? itemScale === 0
      ? 86
      : itemScale === 1
        ? 112
        : 138
    : itemScale === 0
      ? 108
      : itemScale === 1
        ? 144
        : 180;
  const columns = Math.max(
    1,
    Math.min(
      desiredColumns,
      Math.floor((usableWidth + gridGap) / (minimumColumnWidth + gridGap)) || 1,
    ),
  );
  const columnWidth = Math.max(1, (usableWidth - Math.max(0, columns - 1) * gridGap) / columns);
  const thumbInset = compactModeEnabled ? 8 : 10;
  const gridThumbWidth = Math.max(
    itemScale === 0 ? 72 : itemScale === 1 ? 112 : 152,
    columnWidth - thumbInset,
  );
  const gridThumbHeight = Math.max(64, Math.round(gridThumbWidth * 0.6));
  const gridIconSize = itemScale === 0 ? 42 : itemScale === 1 ? 60 : 82;
  const gridItemHeight = Math.max(
    compactModeEnabled ? 122 : GRID_ITEM_HEIGHT,
    gridThumbHeight + (compactModeEnabled ? 76 : 94),
  );
  const rowStride = gridItemHeight + gridGap;
  const rowCount = Math.ceil(itemCount / columns);
  const totalHeight =
    gridPadding * 2 + Math.max(0, rowCount * gridItemHeight + Math.max(0, rowCount - 1) * gridGap);
  const visibleRowCapacity = Math.max(1, Math.ceil(viewportHeight / rowStride));
  const startRow = Math.max(
    0,
    Math.floor(Math.max(0, scrollTop - gridPadding) / rowStride) - GRID_OVERSCAN_ROWS,
  );
  const endRow = Math.min(rowCount, startRow + visibleRowCapacity + GRID_OVERSCAN_ROWS * 2);
  const startIndex = startRow * columns;
  const endIndex = Math.min(itemCount, endRow * columns);
  const visibleItems = useMemo(() => {
    const items: Array<
      { kind: "create"; key: string } | { kind: "entry"; key: string; entry: FileEntry }
    > = [];
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
  const gridItemStyle = {
    minHeight: `${gridItemHeight}px`,
  } as CSSProperties;

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
  }, [
    columns,
    createOffset,
    gridItemHeight,
    gridPadding,
    props.inlineEdit?.entryId,
    props.inlineEdit?.kind,
    props.listing.path,
    rowStride,
  ]);

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
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            left: gridPadding,
            right: gridPadding + scrollbarReserve,
            top: gridTop,
          }}
        >
          {visibleItems.map((item) => {
            if (item.kind === "create") {
              return (
                <div
                  key={item.key}
                  className={`${fileBrowserStyles.gridItem} ${fileBrowserStyles.gridItemInlineEdit} ${fileBrowserStyles.gridItemSelected}`}
                  style={gridItemStyle}
                >
                  <GenericFileIcon
                    kind={props.inlineEdit?.itemKind === "folder" ? "folder" : "file"}
                    size={Math.max(34, gridIconSize - 6)}
                  />
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
                iconSize={gridIconSize}
                style={gridItemStyle}
                selected={selectedIds.has(item.entry.id)}
                cut={props.cutPaths.has(item.entry.path)}
                inlineEdit={activeInlineEdit?.entryId === item.entry.id ? activeInlineEdit : null}
                passiveRename={passiveRenameDrafts.get(item.entry.id) ?? null}
                onSelect={handleSelect}
                onOpen={props.onOpen}
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
