import type {
  FileTableColumn,
  FileTableColumnWidths,
  GridThumbnailSubscriber,
} from "@/models/types/features/explorer/components/FileBrowser";
export type {
  FileTableColumn,
  FileTableColumnWidths,
  GridThumbnailSubscriber,
} from "@/models/types/features/explorer/components/FileBrowser";
import type {
  FileBrowserProps,
  GridThumbnailJob,
} from "@/models/interfaces/features/explorer/components/FileBrowser";
export type {
  FileBrowserProps,
  GridThumbnailJob,
} from "@/models/interfaces/features/explorer/components/FileBrowser";
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
import { formatBytes, formatDate } from "../utils/fileFormat";
import { dragItemsForEntry, transferDropAcceptance } from "./FileBrowserDrag";
import type { FileBrowserDragItem } from "@/models/types/features/explorer/components/FileBrowserDrag";
import { storageIdForPath } from "../drag/operations";
import { useExplorerDragSource, useExplorerDropZone } from "../drag/ExplorerDragContext";
import type {
  ExplorerDragModifiers,
  ExplorerDragPayload,
} from "@/models/interfaces/features/explorer/drag/types";
import { compileEntryFilterMatcher, entryMatchesQuery } from "./FileBrowserFilters";
import { FileIcon, GenericFileIcon } from "./FileBrowserIcons";
import {
  InlineCreateTableRow,
  InlineNameEditor,
  PassiveRenameDraftView,
} from "./FileBrowserInline";
import type { PassiveRenameDraft } from "@/models/types/features/explorer/components/FileBrowserInline";
import { FileBrowserSkeleton } from "./FileBrowserSkeleton";
import { fileBrowserStyles } from "./FileBrowserStyles";
import { FileGrid } from "./fileBrowser/FileGrid";
import { FileTable } from "./fileBrowser/FileTable";
import {
  DEFAULT_ITEM_SCALE,
  GRID_GAP,
  GRID_ITEM_HEIGHT,
  GRID_OVERSCAN_ROWS,
  GRID_PADDING,
  GRID_SCROLLBAR_RESERVE,
  TABLE_OVERSCAN_ROWS,
  defaultColumnWidths,
  fileTableColumnLabels,
  fileTableColumns,
  maximumColumnWidths,
  minimumColumnWidths,
  normalizeItemScale,
} from "./fileBrowser/fileTableConfig";
import {
  clampColumnWidth,
  loadColumnOrder,
  loadColumnWidths,
  clearColumnWidths,
  saveColumnWidths,
} from "./fileBrowser/columnLayout";
import { GridThumbnail } from "./fileBrowser/GridThumbnail";
import { prewarmGridThumbnails } from "./fileBrowser/gridThumbnails";
import {
  formatEntrySize,
  passiveRenameDraftsFor,
  selectedEntriesForListing,
} from "./fileBrowser/entryPresentation";

const emptyEntries: FileEntry[] = [];

export type { FileBrowserDragItem } from "./FileBrowserDrag";

export const FileBrowser = memo(function FileBrowser(props: FileBrowserProps) {
  const deferredCommandQuery = useDeferredValue(props.commandQuery);
  const trimmedCommandQuery = deferredCommandQuery.trim();
  const filterMatcher = useMemo(
    () =>
      props.commandQueryMode === "filter" && !trimmedCommandQuery.startsWith(">")
        ? compileEntryFilterMatcher(trimmedCommandQuery)
        : null,
    [props.commandQueryMode, trimmedCommandQuery],
  );
  const sourceEntries = props.listing?.entries ?? emptyEntries;
  const entries = useMemo(
    () =>
      filterMatcher
        ? sourceEntries.filter((entry) => entryMatchesQuery(entry, filterMatcher))
        : sourceEntries,
    [filterMatcher, sourceEntries],
  );
  const thumbnailPreviewsEnabled = useSettingsStore(
    (state) => selectAppearancePreferences(state.settings?.document).thumbnailPreviewsEnabled,
  );
  const paneDropSpec = useMemo(() => {
    const destination = props.listing?.path ?? "";
    return {
      id: `pane:${props.paneId}`,
      accepts: (payload: ExplorerDragPayload) =>
        destination
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
    return (
      <div className={`${fileBrowserStyles.empty} ${fileBrowserStyles.emptyError}`}>
        {props.error}
      </div>
    );
  }
  if (props.loading) {
    return <FileBrowserSkeleton viewMode={props.viewMode} />;
  }
  if (!props.listing) {
    return <div className={fileBrowserStyles.empty}>Choose a location to begin.</div>;
  }

  const queryActive = Boolean(filterMatcher);
  const displayListing =
    entries === props.listing.entries ? props.listing : { ...props.listing, entries };
  const selectedEntries = selectedEntriesForListing(props.listing.entries, props.selectedIds);
  const selectedBytes = selectedEntries.reduce(
    (sum, entry) => sum + (entrySizeBytes(entry, props.directorySizes) ?? 0),
    0,
  );
  const selectionLabel =
    selectedEntries.length > 0
      ? `${selectedEntries.length} selected${selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ""}`
      : queryActive
        ? `${entries.length} of ${props.listing.totalCount} items`
        : `${props.listing.totalCount} items`;
  return (
    <section
      ref={paneDrop.ref}
      className={fileBrowserStyles.browser}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClearSelection();
      }}
      onContextMenu={
        props.selectionOnly ? (event) => event.preventDefault() : props.onBackgroundContextMenu
      }
    >
      {props.viewMode === "grid" ? (
        <FileGrid {...props} listing={displayListing} />
      ) : (
        <FileTable {...props} listing={displayListing} />
      )}
      <footer className={fileBrowserStyles.footer}>
        <div className={fileBrowserStyles.footerGroup}>
          <span className={fileBrowserStyles.footerItem}>{selectionLabel}</span>
        </div>
      </footer>
    </section>
  );
});
