import { memo, useCallback, useEffect } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { FileBrowser } from "./FileBrowser";
import type { FileBrowserDragItem } from "./FileBrowser";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import type { FileEntry } from "../../../api/types";

const paneStyles = {
  shell:
    "grid h-full min-h-0 w-full min-w-0 grid-rows-[38px_minmax(0,1fr)] overflow-hidden max-[720px]:grid-rows-[36px_minmax(0,1fr)]",
  shellInactive:
    "[&_button]:!text-[#5b5b5b] [&_button:hover]:!text-[#666666] [&_footer]:!text-[#555555] [&_img]:opacity-45 [&_span]:!text-[#5b5b5b] [&_svg]:!text-[#5b5b5b] [&_td]:!text-[#5b5b5b] [&_th]:!text-[#606060]",
  path:
    "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden border-b border-[var(--misty-border-soft)] bg-[var(--misty-surface)] py-0 pl-3 pr-3 text-xs text-[var(--misty-text-subtle)] max-[720px]:min-h-8 max-[720px]:pl-2.5 max-[720px]:pr-2.5 max-[720px]:text-[11px] max-[720px]:text-[var(--misty-text-subtle)]",
  pathText:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  pathActions:
    "flex h-full flex-none items-center overflow-hidden",
} as const;

const emptySelectedIds: string[] = [];

interface ExplorerPaneProps {
  paneId: string;
  path: string;
  isActive?: boolean;
  paneActions?: ReactNode;
}

export const ExplorerPane = memo(function ExplorerPane(props: ExplorerPaneProps) {
  const { pane, viewMode, sort, showHidden, inlineEdit } = useExplorerStore(useShallow((state) => ({
    pane: state.panes[props.paneId],
    viewMode: state.paneViewModes[props.paneId] ?? state.viewMode,
    sort: state.paneSorts[props.paneId] ?? state.sort,
    showHidden: state.paneShowHidden[props.paneId] ?? state.showHidden,
    inlineEdit: inlineEditForPane(state.inlineEdit, props.paneId),
  })));
  const directorySizes = useExplorerStore((state) => state.directorySizes);
  const listing = pane?.listing ?? null;

  useEffect(() => {
    if (pane?.loading) return;
    if (pane?.needsLoad) {
      void useExplorerStore.getState().loadPane(props.paneId, props.path, "replace");
    } else if (!listing || listing.path !== props.path) {
      void useExplorerStore.getState().navigatePane(props.paneId, props.path);
    }
  }, [listing?.path, pane?.loading, pane?.needsLoad, props.paneId, props.path]);

  const handleSelect = useCallback((entryId: string, event: MouseEvent, visibleEntryIds: string[]) => {
    useExplorerStore.getState().selectEntry(props.paneId, entryId, {
      toggle: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
      visibleEntryIds,
    });
  }, [props.paneId]);

  const handleClearSelection = useCallback(() => {
    useExplorerStore.getState().clearSelection(props.paneId);
  }, [props.paneId]);

  const handleOpen = useCallback((entry: FileEntry) => {
    void useExplorerStore.getState().openEntry(props.paneId, entry);
  }, [props.paneId]);

  const handleDownload = useCallback((entry: FileEntry) => {
    useExplorerStore.getState().selectEntry(props.paneId, entry.id);
    void useExplorerStore.getState().downloadSelected(props.paneId);
  }, [props.paneId]);

  const handleContextMenu = useCallback((event: MouseEvent, entry: FileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    useExplorerStore.getState().openContextMenu(props.paneId, event.clientX, event.clientY, entry.id);
  }, [props.paneId]);

  const handleBackgroundContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    useExplorerStore.getState().openContextMenu(props.paneId, event.clientX, event.clientY, null);
  }, [props.paneId]);

  const handleDropItems = useCallback((items: FileBrowserDragItem[], destination: string) => {
    void useExplorerStore.getState().dropItems(props.paneId, items, destination, "move");
  }, [props.paneId]);

  const handleInlineEditCommit = useCallback(() => {
    void useExplorerStore.getState().commitInlineEdit();
  }, []);

  return (
    <div className={`${paneStyles.shell} ${props.isActive === false ? paneStyles.shellInactive : ""}`} data-explorer-pane-id={props.paneId}>
      <div className={paneStyles.path}>
        <span className={paneStyles.pathText} title={props.path}>{compactPanePath(props.path)}</span>
        {props.paneActions ? <div className={paneStyles.pathActions}>{props.paneActions}</div> : null}
      </div>
      <FileBrowser
        paneId={props.paneId}
        listing={listing}
        selectedIds={pane?.selectedIds ?? emptySelectedIds}
        loading={pane?.loading ?? false}
        error={pane?.error ?? null}
        viewMode={viewMode}
        sort={sort}
        showHidden={showHidden}
        commandQuery={pane?.commandQuery ?? ""}
        commandQueryMode={pane?.commandQueryMode ?? "search"}
        directorySizes={directorySizes}
        inlineEdit={inlineEdit}
        onSort={(column) => useExplorerStore.getState().setSort(column, props.paneId)}
        onToggleHidden={() => void useExplorerStore.getState().toggleHidden(props.paneId)}
        onSelect={handleSelect}
        onClearSelection={handleClearSelection}
        onOpen={handleOpen}
        onDownload={handleDownload}
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

function compactPanePath(path: string): string {
  const normalized = path.replace(/\/+/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 4) return normalized || "/";
  return `.../${parts.slice(-4).join("/")}`;
}

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
