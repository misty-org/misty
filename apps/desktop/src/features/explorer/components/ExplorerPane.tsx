import { memo, useCallback, useEffect, useRef } from "react";
import type { DragEvent, MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { FileBrowser } from "./FileBrowser";
import { useExplorerStore } from "../state/useExplorerStore";
import type { FileEntry } from "../../../api/types";

const FOLDER_HOVER_OPEN_DELAY_MS = 3000;
const emptySelectedIds: string[] = [];

interface ExplorerPaneProps {
  paneId: string;
  path: string;
}

export const ExplorerPane = memo(function ExplorerPane(props: ExplorerPaneProps) {
  const { pane, viewMode, sort, inlineEdit } = useExplorerStore(useShallow((state) => ({
    pane: state.panes[props.paneId],
    viewMode: state.paneViewModes[props.paneId] ?? state.viewMode,
    sort: state.paneSorts[props.paneId] ?? state.sort,
    inlineEdit: inlineEditForPane(state.inlineEdit, props.paneId),
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
    const entryWasSelected = currentPane?.selectedIds.includes(entry.id) ?? false;
    if (!entryWasSelected) {
      useExplorerStore.getState().selectEntry(props.paneId, entry.id);
    }
    const selected = entryWasSelected ? currentPane?.selectedIds ?? [entry.id] : [entry.id];
    const selectedEntries = (currentPane?.listing?.entries ?? [])
      .filter((candidate) => selected.includes(candidate.id))
      .filter((candidate) => !candidate.isDeleted);
    const items = selectedEntries.map((candidate) => ({ path: candidate.path, isDirectory: candidate.kind === "folder" }));
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/x-misty-files", JSON.stringify(items));
    event.dataTransfer.setData("text/plain", items.map((item) => item.path).join("\n"));
    setExternalDragData(event, selectedEntries);
    setMistyDragImage(event, items.length);
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
      <div className="explorer-pane-path" title={props.path}>
        {compactPanePath(props.path)}
      </div>
      <FileBrowser
        paneId={props.paneId}
        listing={listing}
        selectedIds={pane?.selectedIds ?? emptySelectedIds}
        loading={pane?.loading ?? false}
        error={pane?.error ?? null}
        viewMode={viewMode}
        sort={sort}
        commandQuery={pane?.commandQuery ?? ""}
        inlineEdit={inlineEdit}
        onSort={(column) => useExplorerStore.getState().setSort(column, props.paneId)}
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

function setExternalDragData(event: DragEvent, entries: FileEntry[]): void {
  const localEntries = entries.filter((entry) => entry.location.kind === "local");
  if (localEntries.length === 0) return;

  const uriList = localEntries.map((entry) => fileUriForPath(entry.path)).join("\r\n");
  event.dataTransfer.setData("text/uri-list", `${uriList}\r\n`);

  const singleFile = localEntries.length === 1 && localEntries[0].kind !== "folder" ? localEntries[0] : null;
  if (singleFile) {
    event.dataTransfer.setData(
      "DownloadURL",
      `${singleFile.mimeType || "application/octet-stream"}:${singleFile.name}:${fileUriForPath(singleFile.path)}`,
    );
  }
}

function setMistyDragImage(event: DragEvent, itemCount: number): void {
  if (typeof document === "undefined" || !event.dataTransfer.setDragImage) return;
  const preview = document.createElement("div");
  preview.className = "explorer-drag-preview";
  preview.textContent = `${event.shiftKey ? "Copy" : "Move"} ${itemCount} ${itemCount === 1 ? "item" : "items"}`;
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 14, 14);
  window.setTimeout(() => preview.remove(), 0);
}

function fileUriForPath(path: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(path)) {
    const [drive, ...segments] = path.replace(/\\/g, "/").split("/");
    return `file:///${drive}/${segments.map(encodeURIComponent).join("/")}`;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `file://${normalized.split("/").map(encodeURIComponent).join("/")}`;
}
