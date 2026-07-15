import type { FileEntry } from "@/native/ipc";
import { memo, useCallback, useEffect, useMemo, type MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  groupItemsByOperation,
  type ExplorerDragModifiers,
  type ExplorerDragPayload,
} from "@/features/file-ui";
import { useExplorerStore } from "../store";
import { FileBrowser } from "./FileBrowser";

const paneStyles = {
  shell: "grid h-full min-h-0 w-full min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden",
  shellInactive: "opacity-65 transition-opacity hover:opacity-85",
} as const;

const emptySelectedIds: string[] = [];

export const ExplorerPane = memo(function ExplorerPane(props: ExplorerPaneProps) {
  const { pane, viewMode, itemScale, sort, showHidden, inlineEdit, clipboard } = useExplorerStore(
    useShallow((state) => ({
      pane: state.panes[props.paneId],
      viewMode: state.paneViewModes[props.paneId] ?? state.viewMode,
      itemScale: state.paneFileItemScales[props.paneId] ?? state.fileItemScale,
      sort: state.paneSorts[props.paneId] ?? state.sort,
      showHidden: state.paneShowHidden[props.paneId] ?? state.showHidden,
      inlineEdit: inlineEditForPane(state.inlineEdit, props.paneId),
      clipboard: state.clipboard,
    })),
  );
  const directorySizes = useExplorerStore((state) => state.directorySizes);
  const listing = pane?.listing ?? null;
  const cutPaths = useMemo(
    () => new Set(clipboard?.operation === "move" ? clipboard.items.map((item) => item.path) : []),
    [clipboard],
  );

  useEffect(() => {
    if (pane?.loading) return;
    if (pane?.needsLoad) {
      void useExplorerStore.getState().loadPane(props.paneId, props.path, "replace");
    } else if (!listing || listing.path !== props.path) {
      void useExplorerStore.getState().navigatePane(props.paneId, props.path);
    }
  }, [listing, pane?.loading, pane?.needsLoad, props.paneId, props.path]);

  const handleSelect = useCallback(
    (entryId: string, event: MouseEvent, visibleEntryIds: string[]) => {
      useExplorerStore.getState().selectEntry(props.paneId, entryId, {
        toggle: event.metaKey || event.ctrlKey,
        range: event.shiftKey,
        visibleEntryIds,
      });
    },
    [props.paneId],
  );

  const handleClearSelection = useCallback(() => {
    useExplorerStore.getState().clearSelection(props.paneId);
  }, [props.paneId]);

  const handleOpen = useCallback(
    (entry: FileEntry) => {
      void useExplorerStore.getState().openEntry(props.paneId, entry);
    },
    [props.paneId],
  );

  const handleContextMenu = useCallback(
    (event: MouseEvent, entry: FileEntry) => {
      event.preventDefault();
      event.stopPropagation();
      useExplorerStore
        .getState()
        .openContextMenu(props.paneId, event.clientX, event.clientY, entry.id);
    },
    [props.paneId],
  );

  const handleBackgroundContextMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      useExplorerStore.getState().openContextMenu(props.paneId, event.clientX, event.clientY, null);
    },
    [props.paneId],
  );

  const handleDropItems = useCallback(
    (
      payload: ExplorerDragPayload,
      destination: string,
      destinationStorageId: string,
      modifiers: ExplorerDragModifiers,
    ) => {
      const store = useExplorerStore.getState();
      if (payload.origin === "external") {
        void store.dropExternalPaths(
          props.paneId,
          payload.items.map((item) => item.path),
          destination,
        );
        return;
      }
      const groups = groupItemsByOperation(
        payload.items,
        destinationStorageId,
        modifiers.copyRequested,
      );
      if (groups.move.length > 0)
        void store.dropItems(props.paneId, groups.move, destination, "move");
      if (groups.copy.length > 0)
        void store.dropItems(props.paneId, groups.copy, destination, "copy");
    },
    [props.paneId],
  );

  const handleInlineEditCommit = useCallback(() => {
    void useExplorerStore.getState().commitInlineEdit();
  }, []);

  return (
    <div
      className={`${paneStyles.shell} ${props.isActive === false ? paneStyles.shellInactive : ""}`}
      data-explorer-pane-id={props.paneId}
    >
      <FileBrowser
        paneId={props.paneId}
        listing={listing}
        selectedIds={pane?.selectedIds ?? emptySelectedIds}
        loading={pane?.showLoadingSkeleton ?? false}
        error={pane?.error ?? null}
        viewMode={viewMode}
        itemScale={itemScale}
        sort={sort}
        showHidden={showHidden}
        commandQuery={pane?.commandQuery ?? ""}
        commandQueryMode={pane?.commandQueryMode ?? "search"}
        directorySizes={directorySizes}
        cutPaths={cutPaths}
        inlineEdit={inlineEdit}
        onSort={(column) => useExplorerStore.getState().setSort(column, props.paneId)}
        onToggleHidden={() => void useExplorerStore.getState().toggleHidden(props.paneId)}
        onSelect={handleSelect}
        onClearSelection={handleClearSelection}
        onOpen={handleOpen}
        onContextMenu={handleContextMenu}
        onBackgroundContextMenu={handleBackgroundContextMenu}
        onDropItems={handleDropItems}
        onInlineEditChange={useExplorerStore.getState().setInlineEditValue}
        onInlineEditCommit={handleInlineEditCommit}
        onInlineEditCancel={useExplorerStore.getState().cancelInlineEdit}
      />
    </div>
  );
});

function inlineEditForPane(
  edit: ReturnType<typeof useExplorerStore.getState>["inlineEdit"],
  paneId: string,
) {
  if (!edit) return null;
  if (edit.paneId === paneId) return edit;
  if (edit.kind === "rename" && edit.batchItems?.some((item) => item.paneId === paneId)) {
    return edit;
  }
  return null;
}

export interface ExplorerPaneProps {
  paneId: string;
  path: string;
  isActive?: boolean;
}
