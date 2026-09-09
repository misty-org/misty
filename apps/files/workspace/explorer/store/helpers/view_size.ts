import type { DirectoryListing, DirectorySizeRecord } from "@/native/contracts";
import type {
  ExplorerSortState,
  ExplorerStore,
  PaneExplorerState,
} from "../../model/interfaces/store/types";
import type {
  ExplorerSortColumn,
  ExplorerSortDirection,
  ExplorerViewMode,
} from "../../model/types/store/types";
import { explorerRuntime, getExplorerStore } from "../runtime";
import * as H from "./index";

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

export { directorySizeRecordForPath, entrySizeBytes } from "../../utils/entrySize";

export {
  sortListing,
  compareEntries,
  compareNullableNumber,
  compareText,
  typeLabel,
} from "../../utils/sortListing";

export type ExplorerStoreSetter = (
  partial:
    | Partial<ExplorerStore>
    | ExplorerStore
    | ((state: ExplorerStore) => Partial<ExplorerStore> | ExplorerStore),
) => void;
