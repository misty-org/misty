import { clipboardImagePng } from "@/features/explorer/utils/clipboardImage";
import { explorerRuntime, getExplorerStore } from "@/features/explorer/store/runtime";
import * as H from "@/features/explorer/store/helpers/index";
import { create } from "zustand";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { hasTauriInternals } from "@/platform/tauri";
import { isAndroidBuild, isNativeMobileBuild } from "@/platform/buildTarget";
import {
  useAppStore,
  selectAdvancedPreferences,
  selectGeneralPreferences,
  selectNotificationPreferences,
  useSettingsStore,
} from "@/stores/app";
import {
  clipboardNativeFileRefs,
  explorerCalculateDirectorySizes,
  explorerDirectorySizeSnapshot,
  clipboardSetLocal,
  clipboardSnapshot,
  clipboardWriteFileRefs,
  explorerListDirectory,
  explorerLibraryRecordLastOpened,
  explorerLibraryRecordRecent,
  explorerLibrarySnapshot,
  explorerOpenAssociation,
  explorerOpenPath,
  explorerSetOpenAssociation,
  explorerOpenWith,
  explorerPathExists,
  explorerPathIsDirectory,
  explorerPrepareDragItems,
  explorerPrepareOpenItem,
  explorerQueuePasteBlob,
  explorerQueueCreateItem,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
  explorerQueuePasteText,
  explorerQueueRenameItem,
  explorerQueueRenameItems,
  transfersSnapshot,
  workspacesSave,
  workspacesSnapshot,
} from "@/stores/backend";
import type { ClipboardOperation, CreateItemKind } from "@/models/types/services/misty-api";
import type {
  ClipboardPayload,
  DirectorySizeRecord,
  DirectoryListing,
  ExplorerLibraryItem,
  ExplorerLibrarySnapshot,
  FileEntry,
  NativeWorkspace,
  NativeWorkspaceDocument,
  NativeWorkspaceExplorerSnapshot,
  PasteItem,
  PreparedOpenItem,
  TransferRecord,
} from "@/models/interfaces/services/misty-api";
import { errorText, userFacingErrorText } from "@/lib/format";
import { useMultiPanelStore } from "@/features/workspace";
import type {
  MultiPanelClosedPane,
  MultiPanelPane,
  MultiPanelTab,
} from "@/models/interfaces/workspace";
import { useOperationQueueStore } from "@/stores/explorer";
import { useTransfersStore } from "@/stores/transfers";
import type {
  ExplorerSortColumn,
  ExplorerSortDirection,
  ExplorerViewMode,
  ExplorerDialogState,
  ExplorerNotificationType,
} from "@/models/types/features/explorer/store/types";
import type {
  ExplorerStore,
  PaneExplorerState,
  ExplorerBatchRenameItem,
  ExplorerInlineEditState,
  ExplorerSortState,
} from "@/models/interfaces/features/explorer/store/types";

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function parseSortState(column: unknown, direction: unknown): ExplorerSortState {
  const parsedColumn: ExplorerSortColumn =
    column === "modified" || column === "size" || column === "type" || column === "name"
      ? column
      : "name";
  const parsedDirection: ExplorerSortDirection = direction === "desc" ? "desc" : "asc";
  return { column: parsedColumn, direction: parsedDirection };
}

export function sortForPane(
  state: Pick<ExplorerStore, "paneSorts" | "sort">,
  paneId: string,
): ExplorerSortState {
  return state.paneSorts[paneId] ?? state.sort;
}

export function viewModeForPane(
  state: Pick<ExplorerStore, "paneViewModes" | "viewMode">,
  paneId: string,
): ExplorerViewMode {
  return state.paneViewModes[paneId] ?? state.viewMode;
}

export function showHiddenForPane(
  state: Pick<ExplorerStore, "paneShowHidden" | "showHidden">,
  paneId: string,
): boolean {
  return state.paneShowHidden[paneId] ?? state.showHidden;
}

export function tabIndex(id: string, fallback: number): number {
  const parsed = Number(id.match(/(\d+)$/)?.[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function workspaceIndex(id: string): number {
  const parsed = Number(id.match(/(\d+)$/)?.[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.9, Math.max(0.1, value));
}

export function titleFromPath(path: string): string {
  if (path.startsWith("misty://local/")) return "Local";
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  if (path === "misty://local") return "Local";
  const clean = H.normalizedPath(path);
  return clean.split("/").filter(Boolean).pop() || clean || "Home";
}

export function ensureDirectorySizeScheduler(): void {
  if (typeof window === "undefined" || explorerRuntime.directorySizeSchedulerTimer !== null) return;
  explorerRuntime.directorySizeSchedulerTimer = window.setInterval(() => {
    void getExplorerStore().getState().runScheduledDirectorySizeRefresh();
  }, explorerRuntime.directorySizeRefreshIntervalMs);
}

export function uniqueDirectorySizePaths(paths: string[]): string[] {
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = H.normalizedPath(path.trim());
    if (!normalized || unique.some((candidate) => H.samePath(candidate, normalized))) continue;
    unique.push(normalized);
  }
  return unique;
}

export function folderPathsForListing(listing: DirectoryListing | null): string[] {
  if (!listing || !H.directorySizeEligibleListing(listing)) return [];
  return listing.entries
    .filter((entry) => !entry.isDeleted && entry.kind === "folder")
    .map((entry) => entry.path);
}

export function directorySizeEligibleListing(listing: DirectoryListing): boolean {
  return (
    !listing.path.includes("://") &&
    (listing.location.kind === "local" || listing.location.kind === "remote")
  );
}

export function openPaneDirectorySizePaths(state: ExplorerStore): string[] {
  return H.uniqueDirectorySizePaths(
    Object.values(state.panes).flatMap((pane) => H.folderPathsForListing(pane.listing)),
  );
}

export function mergeDirectorySizeRecords(
  setState: ExplorerStoreSetter,
  records: DirectorySizeRecord[],
): void {
  if (records.length === 0) return;
  setState((state) => {
    let changed = false;
    const directorySizes = { ...state.directorySizes };
    for (const record of records) {
      const key = H.normalizedPath(record.path);
      const previous = directorySizes[key];
      if (H.directorySizeRecordsEqual(previous, record)) continue;
      directorySizes[key] = { ...record, path: key };
      changed = true;
    }
    if (!changed) return state;
    return {
      directorySizes,
      panes: H.resortSizeSortedPanes(state, directorySizes),
    };
  });
}

export function markDirectorySizesCalculating(
  setState: ExplorerStoreSetter,
  paths: string[],
): void {
  setState((state) => {
    const directorySizes = { ...state.directorySizes };
    let changed = false;
    for (const path of paths) {
      const key = H.normalizedPath(path);
      const previous = directorySizes[key];
      if (previous?.status === "calculating") continue;
      directorySizes[key] = {
        path: key,
        sizeBytes: previous?.sizeBytes ?? null,
        status: "calculating",
        calculatedAtMs: previous?.calculatedAtMs ?? null,
        error: null,
      };
      changed = true;
    }
    return changed ? { directorySizes } : state;
  });
}

export function markDirectorySizesFailed(
  setState: ExplorerStoreSetter,
  paths: string[],
  message: string,
): void {
  setState((state) => {
    const directorySizes = { ...state.directorySizes };
    for (const path of paths) {
      const key = H.normalizedPath(path);
      directorySizes[key] = {
        path: key,
        sizeBytes: null,
        status: "failed",
        calculatedAtMs: Date.now(),
        error: message,
      };
    }
    return { directorySizes };
  });
}

export function resortSizeSortedPanes(
  state: ExplorerStore,
  directorySizes: Record<string, DirectorySizeRecord>,
): Record<string, PaneExplorerState> {
  let panes = state.panes;
  for (const [paneId, pane] of Object.entries(state.panes)) {
    const sort = state.paneSorts[paneId] ?? state.sort;
    if (!pane.listing || sort.column !== "size") continue;
    if (panes === state.panes) panes = { ...state.panes };
    panes[paneId] = { ...pane, listing: H.sortListing(pane.listing, sort, directorySizes) };
  }
  return panes;
}

export function directorySizeRecordsEqual(
  left: DirectorySizeRecord | undefined,
  right: DirectorySizeRecord,
): boolean {
  return (
    Boolean(left) &&
    left!.path === H.normalizedPath(right.path) &&
    left!.sizeBytes === right.sizeBytes &&
    left!.status === right.status &&
    left!.calculatedAtMs === right.calculatedAtMs &&
    (left!.error ?? null) === (right.error ?? null)
  );
}

export function directorySizeRecordForPath(
  directorySizes: Record<string, DirectorySizeRecord>,
  path: string,
): DirectorySizeRecord | undefined {
  return directorySizes[H.normalizedPath(path)];
}

export function entrySizeBytes(
  entry: FileEntry,
  directorySizes: Record<string, DirectorySizeRecord>,
): number | null {
  if (entry.kind !== "folder") return entry.sizeBytes;
  const record = H.directorySizeRecordForPath(directorySizes, entry.path);
  return record?.status === "ready" ? record.sizeBytes : null;
}

export function sortListing(
  listing: DirectoryListing,
  sort: ExplorerSortState,
  directorySizes: Record<string, DirectorySizeRecord> = {},
): DirectoryListing {
  const entries = [...listing.entries].sort((left, right) => {
    const folderBias = Number(right.kind === "folder") - Number(left.kind === "folder");
    if (folderBias !== 0) return folderBias;
    const direction = sort.direction === "asc" ? 1 : -1;
    return H.compareEntries(left, right, sort.column, directorySizes) * direction;
  });
  return { ...listing, entries };
}

export function compareEntries(
  left: FileEntry,
  right: FileEntry,
  column: ExplorerSortColumn,
  directorySizes: Record<string, DirectorySizeRecord>,
): number {
  if (column === "modified") {
    return (
      H.compareNullableNumber(left.modifiedMs, right.modifiedMs) ||
      H.compareText(left.remoteModified, right.remoteModified) ||
      H.compareText(left.name, right.name)
    );
  }
  if (column === "size") {
    return (
      H.compareNullableNumber(
        H.entrySizeBytes(left, directorySizes),
        H.entrySizeBytes(right, directorySizes),
      ) || H.compareText(left.name, right.name)
    );
  }
  if (column === "type") {
    return (
      H.compareText(H.typeLabel(left), H.typeLabel(right)) || H.compareText(left.name, right.name)
    );
  }
  return H.compareText(left.name, right.name);
}

export function compareNullableNumber(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function compareText(left: string | null, right: string | null): number {
  return (left ?? "").localeCompare(right ?? "", undefined, { numeric: true, sensitivity: "base" });
}

export function typeLabel(entry: FileEntry): string {
  return entry.kind === "folder" ? "Folder" : entry.mimeType || entry.extension || entry.kind;
}

export type ExplorerStoreSetter = (
  partial:
    | Partial<ExplorerStore>
    | ExplorerStore
    | ((state: ExplorerStore) => Partial<ExplorerStore> | ExplorerStore),
) => void;
