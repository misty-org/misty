import { memo, useCallback, useEffect, useRef } from "react";
import type { DragEvent, MouseEvent, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { explorerPrepareDragItems } from "../../../api/misty";
import { FileBrowser } from "./FileBrowser";
import { useExplorerStore } from "../state/useExplorerStore";
import type { FileEntry } from "../../../api/types";

const FOLDER_HOVER_OPEN_DELAY_MS = 3000;
const DRAG_PREPARATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PREPARED_DRAG_ITEMS = 256;
const dragPreviewClassName =
  "pointer-events-none fixed -left-[10000px] -top-[10000px] z-[2147483000] rounded-lg border border-[#3a3a3a] bg-[rgba(20, 20, 20, 0.96)] px-[11px] py-2 text-[13px] font-medium leading-none text-[#f0f0f0] shadow-[0_12px_28px_rgba(0,0,0,0.36)]";
const paneStyles = {
  shell:
    "grid h-full min-h-0 w-full min-w-0 grid-rows-[38px_minmax(0,1fr)] overflow-hidden max-[720px]:grid-rows-[36px_minmax(0,1fr)]",
  shellInactive:
    "[&_button]:!text-[#5b5b5b] [&_button:hover]:!text-[#666666] [&_footer]:!text-[#555555] [&_img]:opacity-45 [&_span]:!text-[#5b5b5b] [&_svg]:!text-[#5b5b5b] [&_td]:!text-[#5b5b5b] [&_th]:!text-[#606060]",
  path:
    "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden bg-[#111111] py-0 pl-3 pr-3 text-xs text-[#8f8f8f] max-[720px]:min-h-8 max-[720px]:pl-2.5 max-[720px]:pr-2.5 max-[720px]:text-[11px] max-[720px]:text-[#999999]",
  pathText:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  pathActions:
    "flex h-full flex-none items-center overflow-hidden",
} as const;
const emptySelectedIds: string[] = [];
const preparedDragLocalPaths = new Map<string, { localPath: string; preparedAtMs: number }>();
const preparingDragKeys = new Set<string>();
const dragPreparationNoticeCooldownMs = 2500;
let lastDragPreparationNoticeAt = 0;

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

  const handlePrepareDrag = useCallback((entry: FileEntry) => {
    const currentPane = useExplorerStore.getState().panes[props.paneId];
    if (!currentPane?.listing || entry.isDeleted) return;
    const selected = currentPane.selectedIds.includes(entry.id) ? currentPane.selectedIds : [entry.id];
    const selectedEntries = currentPane.listing.entries
      .filter((candidate) => selected.includes(candidate.id))
      .filter((candidate) => !candidate.isDeleted);
    prepareRemoteDragItems(selectedEntries, { silentWhenReady: true });
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
    prepareRemoteDragItems(selectedEntries, { silentWhenReady: false });
    setMistyDragImage(event, items.length);
  }, [props.paneId]);

  const handleDrop = useCallback((event: DragEvent, destination: string) => {
    event.preventDefault();
    clearHoverNavigation();
    const encoded = event.dataTransfer.getData("application/x-misty-files");
    if (!encoded) {
      const paths = droppedNativeFilePaths(event);
      if (paths.length > 0) {
        void useExplorerStore.getState().dropExternalPaths(props.paneId, paths, destination);
      }
      return;
    }
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
        onPrepareDrag={handlePrepareDrag}
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

function droppedNativeFilePaths(event: DragEvent): string[] {
  return Array.from(event.dataTransfer.files)
    .map((file) => {
      const path = (file as File & { path?: unknown }).path;
      if (typeof path === "string" && path.trim()) return path;
      return file.webkitRelativePath || "";
    })
    .filter((path, index, paths) => path.length > 0 && paths.indexOf(path) === index);
}

function setExternalDragData(event: DragEvent, entries: FileEntry[]): void {
  const localDragItems = entries
    .map((entry) => localDragItemForEntry(entry))
    .filter((item): item is { entry: FileEntry; localPath: string } => Boolean(item));
  if (localDragItems.length !== entries.length) return;

  const uriList = localDragItems.map((item) => fileUriForPath(item.localPath)).join("\r\n");
  event.dataTransfer.setData("text/uri-list", `${uriList}\r\n`);
  event.dataTransfer.setData("text/plain", localDragItems.map((item) => item.localPath).join("\n"));

  const singleFile = localDragItems.length === 1 && localDragItems[0].entry.kind !== "folder" ? localDragItems[0] : null;
  if (singleFile) {
    event.dataTransfer.setData(
      "DownloadURL",
      `${singleFile.entry.mimeType || "application/octet-stream"}:${downloadUrlFileName(singleFile.entry.name)}:${fileUriForPath(singleFile.localPath)}`,
    );
  }
}

function localDragItemForEntry(entry: FileEntry): { entry: FileEntry; localPath: string } | null {
  if (entry.location.kind === "local") return { entry, localPath: entry.path };
  const key = dragPreparationKey(entry);
  const prepared = preparedDragLocalPaths.get(key);
  if (!prepared) return null;
  if (dragPreparationExpired(prepared, Date.now())) {
    preparedDragLocalPaths.delete(key);
    return null;
  }
  return { entry, localPath: prepared.localPath };
}

function prepareRemoteDragItems(
  entries: FileEntry[],
  options: { silentWhenReady: boolean },
): void {
  prunePreparedDragItems(Date.now());
  const remoteEntries = entries.filter((entry) => entry.location.kind !== "local");
  const preparing = remoteEntries.filter((entry) => {
    const key = dragPreparationKey(entry);
    return !preparedDragLocalPaths.has(key) && preparingDragKeys.has(key);
  });
  const missing = remoteEntries.filter((entry) => {
    const key = dragPreparationKey(entry);
    return !preparedDragLocalPaths.has(key) && !preparingDragKeys.has(key);
  });
  if (missing.length === 0) {
    if (!options.silentWhenReady && preparing.length > 0) {
      notifyDragPreparation(
        `Still preparing ${preparing.length} remote ${preparing.length === 1 ? "item" : "items"} for drag-out...`,
        "info",
        2500,
        false,
      );
    }
    return;
  }

  for (const entry of missing) {
    preparingDragKeys.add(dragPreparationKey(entry));
  }
  if (!options.silentWhenReady) {
    notifyDragPreparation(
      `Preparing ${missing.length} remote ${missing.length === 1 ? "item" : "items"} for drag-out...`,
      "info",
      3500,
      false,
    );
  }

  void explorerPrepareDragItems({
    items: missing.map((entry) => ({
      path: entry.path,
      isDirectory: entry.kind === "folder",
      sizeBytes: entry.sizeBytes,
      remoteModified: entry.remoteModified,
    })),
  })
    .then((result) => {
      for (const entry of missing) {
        preparingDragKeys.delete(dragPreparationKey(entry));
      }
      const preparedAtMs = Date.now();
      for (const item of result.items) {
        const match = missing.find((entry) => entry.path === item.sourcePath);
        if (match) {
          preparedDragLocalPaths.set(dragPreparationKey(match), {
            localPath: item.localPath,
            preparedAtMs,
          });
        }
      }
      prunePreparedDragItems(preparedAtMs);
      if (!options.silentWhenReady && result.items.length > 0) {
        notifyDragPreparation(
          `Prepared ${result.items.length} remote ${result.items.length === 1 ? "item" : "items"} for drag-out. Drag again to use the local staged ${result.items.length === 1 ? "file" : "files"}.`,
          "success",
          6000,
          false,
        );
      }
      if (result.skipped.length > 0) {
        notifyDragPreparation(
          skippedDragPreparationMessage(result.skipped),
          "error",
          8000,
          true,
        );
      }
    })
    .catch((error) => {
      for (const entry of missing) {
        preparingDragKeys.delete(dragPreparationKey(entry));
      }
      notifyDragPreparation(`Remote drag-out preparation failed: ${String(error)}`, "error", 6000, true);
    });
}

function notifyDragPreparation(
  message: string,
  type: "info" | "success" | "error",
  durationMs: number,
  showInActivity: boolean,
): void {
  if (type !== "error") {
    const now = Date.now();
    if (now - lastDragPreparationNoticeAt < dragPreparationNoticeCooldownMs) return;
    lastDragPreparationNoticeAt = now;
  }
  useExplorerStore.getState().pushNotification(message, type, durationMs, showInActivity);
}

function skippedDragPreparationMessage(skipped: { sourcePath: string; reason: string }[]): string {
  const count = skipped.length;
  const itemText = count === 1 ? "item" : "items";
  const first = skipped[0];
  const detail = first?.reason?.trim();
  if (!detail) return `Could not prepare ${count} remote ${itemText} for drag-out.`;

  const name = first.sourcePath.split(/[\\/]/).filter(Boolean).pop();
  const prefix = name
    ? `Could not prepare ${name} for drag-out`
    : `Could not prepare ${count} remote ${itemText} for drag-out`;
  const suffix = count > 1 ? ` (${count - 1} more ${count === 2 ? "item" : "items"} failed)` : "";
  return `${prefix}: ${detail}${suffix}`;
}

function dragPreparationKey(entry: FileEntry): string {
  return [
    entry.path,
    entry.kind === "folder" ? "dir" : "file",
    entry.sizeBytes ?? 0,
    entry.remoteModified ?? "",
  ].join("\n");
}

function dragPreparationExpired(
  prepared: { preparedAtMs: number },
  nowMs: number,
): boolean {
  return prepared.preparedAtMs <= 0 || nowMs - prepared.preparedAtMs > DRAG_PREPARATION_CACHE_TTL_MS;
}

function prunePreparedDragItems(nowMs: number): void {
  for (const [key, prepared] of preparedDragLocalPaths) {
    if (dragPreparationExpired(prepared, nowMs)) {
      preparedDragLocalPaths.delete(key);
    }
  }
  while (preparedDragLocalPaths.size > MAX_PREPARED_DRAG_ITEMS) {
    const oldestKey = preparedDragLocalPaths.keys().next().value;
    if (!oldestKey) break;
    preparedDragLocalPaths.delete(oldestKey);
  }
}

function setMistyDragImage(event: DragEvent, itemCount: number): void {
  if (typeof document === "undefined" || !event.dataTransfer.setDragImage) return;
  const preview = document.createElement("div");
  preview.className = dragPreviewClassName;
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

function downloadUrlFileName(name: string): string {
  const safe = name.replace(/[\r\n:]/g, "_").trim();
  return safe || "download";
}
