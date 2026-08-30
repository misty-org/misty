import { useAppStore } from "@/features/app-shell";
import { selectGeneralPreferences, useSettingsStore } from "@/features/settings";
import { useTransfersStore } from "@/features/transfers";
import type { FileEntry, PasteItem } from "@/native/contracts";
import type { CreateItemKind } from "@/native/contracts/primitives";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { useOperationQueueStore } from "..";

import type {
  ExplorerBatchRenameItem,
  ExplorerInlineEditState,
  PaneExplorerState,
} from "../../model/interfaces/store/types";
import type { ExplorerDeleteMode, ExplorerDialogState } from "../../model/types/store/types";
import { getExplorerStore } from "../runtime";
import * as H from "./index";

export function emptyPaneState(): PaneExplorerState {
  return {
    listing: null,
    hasFolderEntries: false,
    commandQuery: "",
    commandQueryMode: "search",
    selectedIds: [],
    selectedIdsByPath: {},
    lastSelectedIndexByPath: {},
    backHistory: [],
    forwardHistory: [],
    loading: false,
    showLoadingSkeleton: false,
    needsLoad: false,
    error: null,
  };
}

export function selectedEntryForPane(pane: PaneExplorerState | undefined): FileEntry | null {
  if (!pane?.listing || pane.selectedIds.length === 0) return null;
  return pane.listing.entries.find((entry) => entry.id === pane.selectedIds[0]) ?? null;
}

export function paneExplorerStatesEqual(
  left: PaneExplorerState,
  right: PaneExplorerState,
): boolean {
  return (
    left === right ||
    (left.listing === right.listing &&
      left.hasFolderEntries === right.hasFolderEntries &&
      left.commandQuery === right.commandQuery &&
      left.commandQueryMode === right.commandQueryMode &&
      H.arraysEqual(left.selectedIds, right.selectedIds) &&
      left.selectedIdsByPath === right.selectedIdsByPath &&
      left.lastSelectedIndexByPath === right.lastSelectedIndexByPath &&
      H.arraysEqual(left.backHistory, right.backHistory) &&
      H.arraysEqual(left.forwardHistory, right.forwardHistory) &&
      left.loading === right.loading &&
      left.showLoadingSkeleton === right.showLoadingSkeleton &&
      left.needsLoad === right.needsLoad &&
      left.error === right.error)
  );
}

export function selectedEntriesForPane(pane: PaneExplorerState | undefined): FileEntry[] {
  if (!pane?.listing || pane.selectedIds.length === 0) return [];
  if (pane.selectedIds.length === 1) {
    const entry = H.selectedEntryForPane(pane);
    return entry ? [entry] : [];
  }
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) => selected.has(entry.id));
}

export function selectedRemotePasteItemsForPane(pane: PaneExplorerState | undefined): PasteItem[] {
  return H.selectedEntriesForPane(pane)
    .filter((entry) => !entry.isDeleted && entry.location.kind === "remote")
    .map(H.pasteItemForEntry);
}

export function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function itemCountLabel(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

export function defaultDownloadsDirectory(): string {
  const homeDir = useAppStore.getState().app?.environment.homeDir;
  return homeDir ? H.joinExplorerPath(homeDir, "Downloads") : "Downloads";
}

export async function downloadDestinationDirectory(): Promise<string | null> {
  const defaultDirectory = H.defaultDownloadsDirectory();
  const transferBehaviorIndex = selectGeneralPreferences(
    useSettingsStore.getState().settings?.document,
  ).defaultTransferBehaviorIndex;
  if (transferBehaviorIndex === 1) {
    return defaultDirectory;
  }
  if (!hasTauriInternals()) {
    return defaultDirectory;
  }
  const selection = await open({
    title: "Choose Download Folder",
    multiple: false,
    directory: true,
    defaultPath: defaultDirectory,
  });
  if (!selection) return null;
  return Array.isArray(selection) ? (selection[0] ?? null) : selection;
}

export function joinExplorerPath(...parts: string[]): string {
  const clean = parts
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.replace(/\/+$/g, "") : part.replace(/^\/+|\/+$/g, ""),
    )
    .filter(Boolean);
  if (clean.length === 0) return "/";
  return clean.join("/");
}

export function splitRenameParts(entry: FileEntry): [string, string] {
  if (entry.kind === "folder") return [entry.name, ""];
  const dot = entry.name.lastIndexOf(".");
  if (dot <= 0) return [entry.name, ""];
  return [entry.name.slice(0, dot), entry.name.slice(dot)];
}

export function makeBatchRenameItem(
  entry: FileEntry,
  paneId: string,
  pane: PaneExplorerState,
): ExplorerBatchRenameItem {
  const [value, lockedExtension] = H.splitRenameParts(entry);
  return {
    paneId,
    entryId: entry.id,
    path: entry.path,
    directoryPath: pane.listing?.path ?? H.parentDirectory(entry.path),
    originalName: entry.name,
    value,
    lockedExtension,
    isDirectory: entry.kind === "folder",
    siblingNames: (pane.listing?.entries ?? [])
      .filter((candidate) => candidate.id !== entry.id)
      .map((candidate) => candidate.name),
    error: null,
  };
}

export function selectedBatchRenameItemsAcrossPanes(
  panes: Record<string, PaneExplorerState>,
  activePaneId: string,
): ExplorerBatchRenameItem[] {
  const paneEntries = Object.entries(panes);
  const orderedPaneEntries = [
    ...paneEntries.filter(([paneId]) => paneId === activePaneId),
    ...paneEntries.filter(([paneId]) => paneId !== activePaneId),
  ];
  const seenPaths = new Set<string>();
  const items: ExplorerBatchRenameItem[] = [];
  for (const [paneId, pane] of orderedPaneEntries) {
    if (pane.listing?.path === "misty://trash") continue;
    for (const entry of H.selectedEntriesForPane(pane)) {
      if (!H.isFileMasterEntry(entry)) continue;
      const pathKey = H.normalizedPath(entry.path);
      if (seenPaths.has(pathKey)) continue;
      seenPaths.add(pathKey);
      items.push(H.makeBatchRenameItem(entry, paneId, pane));
    }
  }
  return items;
}

export function syncInlineRenameSelection(
  edit: ExplorerInlineEditState | null,
  panes: Record<string, PaneExplorerState>,
  preferredPaneId?: string,
  preferredEntryId?: string,
): ExplorerInlineEditState | null {
  if (edit?.kind !== "rename") return edit;

  const items = H.selectedBatchRenameItemsAcrossPanes(panes, preferredPaneId ?? edit.paneId);
  if (items.length === 0) return null;

  const focusItem =
    items.find((item) => item.paneId === preferredPaneId && item.entryId === preferredEntryId) ??
    items.find((item) => item.paneId === edit.paneId && item.entryId === edit.entryId) ??
    items[0];
  const batchItems = H.validateBatchRenameItems(
    items.map((item) => ({ ...item, value: edit.value })),
  );
  const focused =
    batchItems.find(
      (item) => item.paneId === focusItem.paneId && item.entryId === focusItem.entryId,
    ) ?? focusItem;
  const next: ExplorerInlineEditState = {
    ...edit,
    paneId: focusItem.paneId,
    itemKind: focusItem.isDirectory ? "folder" : "file",
    entryId: focusItem.entryId,
    originalName: focusItem.originalName,
    lockedExtension: focusItem.lockedExtension,
    batchItems: batchItems.length > 1 ? batchItems : undefined,
    error: focused.error,
  };
  return H.withInlineEditValidation(next, panes[next.paneId]);
}

export function validateRenameValue(
  value: string,
  lockedExtension: string,
  originalName: string,
  entryId: string | null,
  pane: PaneExplorerState | undefined,
  reservedNames: Set<string> | null = null,
): string | null {
  const trimmedValue = value.trim();
  const effectiveName = `${trimmedValue}${lockedExtension}`;
  if (!trimmedValue) {
    return "Name cannot be empty.";
  }
  if (value !== trimmedValue) {
    return "Name cannot begin or end with spaces.";
  }
  if (value.includes("/") || value.includes("\\")) {
    return "Name cannot contain path separators.";
  }
  if (value.includes("\0")) {
    return "Name contains an invalid character.";
  }
  if (
    effectiveName !== originalName &&
    pane?.listing?.entries.some(
      (entry) =>
        entry.id !== entryId && !reservedNames?.has(entry.id) && entry.name === effectiveName,
    )
  ) {
    return "Name already exists in this folder.";
  }
  return null;
}

export function validateBatchRenameItems(
  items: ExplorerBatchRenameItem[],
): ExplorerBatchRenameItem[] {
  const targetCounts = new Map<string, number>();
  for (const item of items) {
    const effectiveName = `${item.value.trim()}${item.lockedExtension}`;
    const targetPath = H.renameTargetPath(item.directoryPath, effectiveName);
    targetCounts.set(targetPath, (targetCounts.get(targetPath) ?? 0) + 1);
  }
  return items.map((item) => {
    const effectiveName = `${item.value.trim()}${item.lockedExtension}`;
    const baseError = H.validateRenameValue(
      item.value,
      item.lockedExtension,
      item.originalName,
      item.entryId,
      undefined,
    );
    const targetPath = H.renameTargetPath(item.directoryPath, effectiveName);
    const error =
      baseError ??
      ((targetCounts.get(targetPath) ?? 0) > 1
        ? "Another selected item will use this name."
        : null) ??
      (effectiveName !== item.originalName && item.siblingNames.includes(effectiveName)
        ? "Name already exists in this folder."
        : null);
    return { ...item, error };
  });
}

export function inlineEditFromBatchRenameDialog(
  dialog: NonNullable<ExplorerDialogState> & { kind: "batchRename" },
): ExplorerInlineEditState | null {
  const focusItem = dialog.items.find((item) => item.paneId === dialog.paneId) ?? dialog.items[0];
  if (!focusItem) return null;
  const batchItems = H.validateBatchRenameItems(dialog.items);
  const focused = batchItems.find(
    (item) => item.paneId === focusItem.paneId && item.entryId === focusItem.entryId,
  );
  const invalidCount = batchItems.filter((item) => item.error).length;
  const restored: ExplorerInlineEditState = {
    paneId: focusItem.paneId,
    kind: "rename",
    itemKind: focusItem.isDirectory ? "folder" : "file",
    entryId: focusItem.entryId,
    originalName: focusItem.originalName,
    value: focusItem.value,
    lockedExtension: focusItem.lockedExtension,
    batchItems,
    error:
      focused?.error ??
      (invalidCount > 0
        ? `${invalidCount} selected ${invalidCount === 1 ? "item needs" : "items need"} review.`
        : null),
  };
  return restored;
}

export function renameTargetPath(directoryPath: string, name: string): string {
  const directory = H.normalizedPath(directoryPath);
  return directory === "/" ? `/${name}` : `${directory}/${name}`;
}

export function refreshAndClearRenamePanes(items: ExplorerBatchRenameItem[]): void {
  const paneDirectories = new Map<string, Set<string>>();
  for (const item of items) {
    const directories = paneDirectories.get(item.paneId) ?? new Set<string>();
    directories.add(item.directoryPath);
    paneDirectories.set(item.paneId, directories);
  }
  const store = getExplorerStore().getState();
  for (const [paneId, directories] of paneDirectories) {
    store.clearSelection(paneId);
    for (const directory of directories) {
      H.queuePaneRefresh(paneId, directory);
    }
  }
}

export function refreshTransferViews(): void {
  void useTransfersStore.getState().load(undefined, { silent: true });
  void useOperationQueueStore.getState().load({ silent: true });
}

export function withInlineEditValidation(
  edit: ExplorerInlineEditState,
  pane: PaneExplorerState | undefined,
): ExplorerInlineEditState {
  if (edit.kind === "rename" && edit.batchItems && edit.batchItems.length > 1) {
    const batchItems = H.validateBatchRenameItems(
      edit.batchItems.map((item) =>
        item.paneId === edit.paneId && item.entryId === edit.entryId
          ? { ...item, value: edit.value }
          : item,
      ),
    );
    const focused = batchItems.find(
      (item) => item.paneId === edit.paneId && item.entryId === edit.entryId,
    );
    const invalidCount = batchItems.filter((item) => item.error).length;
    const error =
      focused?.error ??
      (invalidCount > 0
        ? `${invalidCount} selected ${invalidCount === 1 ? "item needs" : "items need"} review.`
        : null);
    return { ...edit, batchItems, error };
  }
  const error = H.validateRenameValue(
    edit.value,
    edit.lockedExtension,
    edit.originalName,
    edit.entryId,
    pane,
  );
  return { ...edit, error };
}

export function canCreateItemInPane(
  pane: PaneExplorerState | undefined,
  kind: CreateItemKind,
  inlineEdit: ExplorerInlineEditState | null,
): boolean {
  if (inlineEdit || !pane?.listing) return false;
  if (pane.listing.path.startsWith("misty://")) return false;
  if (pane.listing.location.kind === "remote_provider") return false;
  return true;
}

export function selectedPathsForPane(pane: PaneExplorerState | undefined): string[] {
  if (!pane?.listing) return [];
  if (pane.listing.path === "misty://trash") return [];
  if (pane.selectedIds.length === 1) {
    const entry = H.selectedEntryForPane(pane);
    return entry && H.isFileMasterEntry(entry) ? [entry.path] : [];
  }
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries
    .filter((entry) => selected.has(entry.id) && H.isFileMasterEntry(entry))
    .map((entry) => entry.path);
}

export function selectedDeletePathsForPane(
  pane: PaneExplorerState | undefined,
  permanent: boolean,
): string[] {
  if (!pane?.listing) return [];
  const selected = new Set(pane.selectedIds);
  const inTrash = pane.listing.path === "misty://trash";
  return pane.listing.entries
    .filter((entry) => {
      if (!selected.has(entry.id)) return false;
      if (entry.readonly || entry.location.kind === "peer_device") return false;
      if (inTrash) return permanent && entry.isDeleted;
      return permanent ? !entry.isDeleted : !entry.isDeleted && entry.location.kind === "local";
    })
    .map((entry) => entry.path);
}

export function selectedPasteItemsForPane(pane: PaneExplorerState | undefined): PasteItem[] {
  if (!pane?.listing) return [];
  if (pane.listing.path === "misty://trash") return [];
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries
    .filter((entry) => selected.has(entry.id) && H.isFileMasterEntry(entry))
    .map(H.pasteItemForEntry);
}

export function pasteItemForEntry(entry: FileEntry): PasteItem {
  return {
    path: entry.path,
    isDirectory: entry.kind === "folder",
    sizeBytes: entry.sizeBytes,
    remoteModified: entry.remoteModified,
  };
}

export function isFileMasterEntry(entry: FileEntry): boolean {
  return !entry.isDeleted;
}

export function deleteModeForPaneSelection(
  pane: PaneExplorerState | undefined,
  requestedMode: ExplorerDeleteMode | undefined,
): ExplorerDeleteMode {
  if (requestedMode) return requestedMode;
  if (pane?.listing?.path === "misty://trash") return "permanent";
  const selected = new Set(pane?.selectedIds ?? []);
  const selectedEntries =
    pane?.listing?.entries.filter((entry) => selected.has(entry.id) && !entry.isDeleted) ?? [];
  const hasRemoteSelection = selectedEntries.some(
    (entry) => selected.has(entry.id) && !entry.isDeleted && entry.location.kind === "remote",
  );
  const hasLocalSelection = selectedEntries.some((entry) => entry.location.kind === "local");
  return hasRemoteSelection && !hasLocalSelection ? "permanent" : "trash";
}

export function deleteQueuedMessage(count: number, permanent: boolean): string {
  return `Queued ${permanent ? "permanent delete" : "trash"} for ${H.itemCountLabel(count)}`;
}
