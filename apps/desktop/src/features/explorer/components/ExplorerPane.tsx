import { memo, useCallback, useEffect, useRef } from "react";
import type { DragEvent, MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { FileBrowser } from "./FileBrowser";
import { useExplorerStore } from "../state/useExplorerStore";
import type { FileEntry } from "../../../api/types";

const FOLDER_HOVER_OPEN_DELAY_MS = 3000;

interface ExplorerPaneProps {
  paneId: string;
  path: string;
}

export const ExplorerPane = memo(function ExplorerPane(props: ExplorerPaneProps) {
  const { pane, viewMode, sort, inlineEdit } = useExplorerStore(useShallow((state) => ({
    pane: state.panes[props.paneId],
    viewMode: state.viewMode,
    sort: state.sort,
    inlineEdit: state.inlineEdit?.paneId === props.paneId ? state.inlineEdit : null,
  })));
  const listing = pane?.listing ?? null;
  const hoverTimerRef = useRef<number | null>(null);
  const hoverTargetRef = useRef<string | null>(null);

  const clearHoverNavigation = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    hoverTargetRef.current = null;
  }, []);

  useEffect(() => clearHoverNavigation, [clearHoverNavigation]);

  useEffect(() => {
    if (pane?.loading) return;
    if (!listing || listing.path !== props.path) {
      void useExplorerStore.getState().navigatePane(props.paneId, props.path);
    }
  }, [listing?.path, pane?.loading, props.paneId, props.path]);

  const handleSelect = useCallback((entryId: string, event: MouseEvent) => {
    useExplorerStore.getState().selectEntry(props.paneId, entryId, {
      toggle: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
    });
  }, [props.paneId]);

  const handleClearSelection = useCallback(() => {
    useExplorerStore.getState().clearSelection(props.paneId);
  }, [props.paneId]);

  const handleOpen = useCallback((entry: FileEntry) => {
    void useExplorerStore.getState().openEntry(props.paneId, entry);
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

  const handleDragStart = useCallback((event: DragEvent, entry: FileEntry) => {
    const currentPane = useExplorerStore.getState().panes[props.paneId];
    const selected = currentPane?.selectedIds.includes(entry.id) ? currentPane.selectedIds : [entry.id];
    const items = (currentPane?.listing?.entries ?? [])
      .filter((candidate) => selected.includes(candidate.id))
      .map((candidate) => ({ path: candidate.path, isDirectory: candidate.kind === "folder" }));
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/x-misty-files", JSON.stringify(items));
    event.dataTransfer.setData("text/plain", items.map((item) => item.path).join("\n"));
  }, [props.paneId]);

  const handleDrop = useCallback((event: DragEvent, destination: string) => {
    event.preventDefault();
    clearHoverNavigation();
    const encoded = event.dataTransfer.getData("application/x-misty-files");
    if (!encoded) return;
    try {
      const items = JSON.parse(encoded) as Array<{ path: string; isDirectory: boolean }>;
      void useExplorerStore.getState().dropItems(
        props.paneId,
        items,
        destination,
        event.shiftKey ? "copy" : "move",
      );
    } catch {
      // Ignore malformed external drag payloads.
    }
  }, [clearHoverNavigation, props.paneId]);

  const handleDragHover = useCallback((destination: string) => {
    const currentPath = useExplorerStore.getState().panes[props.paneId]?.listing?.path;
    if (!destination || destination === currentPath) {
      clearHoverNavigation();
      return;
    }
    if (hoverTargetRef.current === destination) return;
    clearHoverNavigation();
    hoverTargetRef.current = destination;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      const latestPath = useExplorerStore.getState().panes[props.paneId]?.listing?.path;
      if (latestPath !== destination) {
        void useExplorerStore.getState().navigatePane(props.paneId, destination);
      }
    }, FOLDER_HOVER_OPEN_DELAY_MS);
  }, [clearHoverNavigation, props.paneId]);

  const handleInlineEditCommit = useCallback(() => {
    void useExplorerStore.getState().commitInlineEdit();
  }, []);

  return (
    <div className="explorer-pane-shell" data-explorer-pane-id={props.paneId}>
      <FileBrowser
        listing={listing}
        selectedIds={pane?.selectedIds ?? []}
        loading={pane?.loading ?? false}
        error={pane?.error ?? null}
        viewMode={viewMode}
        sort={sort}
        commandQuery={pane?.commandQuery ?? ""}
        inlineEdit={inlineEdit}
        onSort={useExplorerStore.getState().setSort}
        onSelect={handleSelect}
        onClearSelection={handleClearSelection}
        onOpen={handleOpen}
        onContextMenu={handleContextMenu}
        onBackgroundContextMenu={handleBackgroundContextMenu}
        onDragStart={handleDragStart}
        onDragEnd={clearHoverNavigation}
        onDragHover={handleDragHover}
        onDrop={handleDrop}
        onInlineEditChange={useExplorerStore.getState().setInlineEditValue}
        onInlineEditCommit={handleInlineEditCommit}
        onInlineEditCancel={useExplorerStore.getState().cancelInlineEdit}
      />
    </div>
  );
});
