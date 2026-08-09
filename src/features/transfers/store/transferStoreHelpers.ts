import type { TransferPage } from "@/services/misty/model/misty-api";
import type { TransferStatus, TransferType } from "@/services/misty/model/types/misty-api";
import type {
  TransferLocationScope,
  TransferSortDirection,
  TransferSortKey,
  TransferStatusFilter,
} from "../model/stores/transfers/types/useTransfersStore";
export const transferTypes: TransferType[] = [
  "upload",
  "download",
  "archive",
  "create",
  "copy",
  "move",
  "rename",
  "delete",
];

export function activeTransferFilterCount(
  state: Pick<
    TransferWorkspaceState,
    "providerFilters" | "typeFilters" | "locationScope" | "statusFilter"
  >,
): number {
  return (
    state.providerFilters.size +
    state.typeFilters.size +
    (state.locationScope === "all" ? 0 : 1) +
    (state.statusFilter === "all" ? 0 : 1)
  );
}

export function createTransferWorkspaceState(): TransferWorkspaceState {
  return {
    search: "",
    selectedIds: new Set(),
    lastSelectedId: null,
    providerFilters: new Set(),
    typeFilters: new Set(),
    locationScope: "all",
    statusFilter: "all",
    sortKey: "time",
    sortDirection: "desc",
    pageIndex: 0,
    focusedTransferId: null,
  };
}

export function updateWorkspace(
  set: (
    partial:
      | Partial<TransfersStore>
      | TransfersStore
      | ((state: TransfersStore) => Partial<TransfersStore> | TransfersStore),
  ) => void,
  workspaceId: string,
  update: (workspace: TransferWorkspaceState) => TransferWorkspaceState,
): void {
  if (!workspaceId) return;
  set((state) => {
    const current = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
    const next = update(current);
    return next === current ? state : withWorkspace(state, workspaceId, next);
  });
}

export function withWorkspace(
  state: Pick<TransfersStore, "workspaces">,
  workspaceId: string,
  workspace: TransferWorkspaceState,
): Partial<TransfersStore> {
  if (!workspaceId) return {};
  return { workspaces: { ...state.workspaces, [workspaceId]: workspace } };
}

export function pruneWorkspaces(
  workspaces: Record<string, TransferWorkspaceState>,
  visibleIds: Set<number>,
): Record<string, TransferWorkspaceState> {
  let changed = false;
  const next = Object.fromEntries(
    Object.entries(workspaces).map(([workspaceId, workspace]) => {
      const selectedIds = pruneSelectedIds(workspace.selectedIds, visibleIds);
      const focusedTransferId =
        workspace.focusedTransferId == null || visibleIds.has(workspace.focusedTransferId)
          ? workspace.focusedTransferId
          : null;
      const lastSelectedId =
        workspace.lastSelectedId == null || visibleIds.has(workspace.lastSelectedId)
          ? workspace.lastSelectedId
          : null;
      if (
        selectedIds !== workspace.selectedIds ||
        focusedTransferId !== workspace.focusedTransferId ||
        lastSelectedId !== workspace.lastSelectedId
      ) {
        changed = true;
        return [workspaceId, { ...workspace, selectedIds, focusedTransferId, lastSelectedId }];
      }
      return [workspaceId, workspace];
    }),
  );
  return changed ? next : workspaces;
}

export function transferStatusMatchesFilter(
  status: TransferStatus,
  filter: TransferStatusFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "completed") return status === "completed";
  if (filter === "failed") return status === "failed" || status === "interrupted";
  return (
    status === "queued" ||
    status === "pending" ||
    status === "in_progress" ||
    status === "waiting_for_resolution"
  );
}

export function pruneSelectedIds(selectedIds: Set<number>, visibleIds: Set<number>): Set<number> {
  const next = new Set([...selectedIds].filter((id) => visibleIds.has(id)));
  if (next.size !== selectedIds.size) return next;
  for (const id of next) {
    if (!selectedIds.has(id)) return next;
  }
  return selectedIds;
}

export function transferPagesEqual(left: TransferPage | null, right: TransferPage): boolean {
  if (!left) return false;
  if (
    left.totalCount !== right.totalCount ||
    left.dbPath !== right.dbPath ||
    left.rows.length !== right.rows.length
  ) {
    return false;
  }
  return left.rows.every((row, index) => transferRowsEqual(row, right.rows[index]));
}

export function transferRowsEqual(
  left: TransferPage["rows"][number],
  right: TransferPage["rows"][number],
): boolean {
  return (
    left.id === right.id &&
    left.jobId === right.jobId &&
    left.operationId === right.operationId &&
    left.batchId === right.batchId &&
    left.parentTransferId === right.parentTransferId &&
    left.rootTransferId === right.rootTransferId &&
    left.treeDepth === right.treeDepth &&
    left.transferType === right.transferType &&
    left.itemType === right.itemType &&
    left.status === right.status &&
    left.conflictPolicy === right.conflictPolicy &&
    left.queueTitle === right.queueTitle &&
    left.fileName === right.fileName &&
    left.localSourcePath === right.localSourcePath &&
    left.localDestPath === right.localDestPath &&
    left.remoteSourceName === right.remoteSourceName &&
    left.remoteSourcePath === right.remoteSourcePath &&
    left.remoteDestName === right.remoteDestName &&
    left.remoteDestPath === right.remoteDestPath &&
    left.totalBytes === right.totalBytes &&
    left.transferredBytes === right.transferredBytes &&
    left.bytesPerSecond === right.bytesPerSecond &&
    left.errorMessage === right.errorMessage &&
    left.detailMessage === right.detailMessage &&
    left.queuedAtMs === right.queuedAtMs &&
    left.startedAtMs === right.startedAtMs &&
    left.completedAtMs === right.completedAtMs &&
    left.cancelable === right.cancelable &&
    left.retryable === right.retryable &&
    left.undoable === right.undoable &&
    left.undoTokenId === right.undoTokenId &&
    left.preserveOrder === right.preserveOrder &&
    left.paused === right.paused &&
    left.attempt === right.attempt &&
    left.supportsReplace === right.supportsReplace &&
    left.supportsKeepBoth === right.supportsKeepBoth
  );
}

export interface TransferWorkspaceState {
  search: string;
  selectedIds: Set<number>;
  lastSelectedId: number | null;
  providerFilters: Set<string>;
  typeFilters: Set<TransferType>;
  locationScope: TransferLocationScope;
  statusFilter: TransferStatusFilter;
  sortKey: TransferSortKey;
  sortDirection: TransferSortDirection;
  pageIndex: number;
  focusedTransferId: number | null;
}

export interface TransfersStore {
  transfers: TransferPage | null;
  workspaces: Record<string, TransferWorkspaceState>;
  working: boolean;
  error: string | null;
  message: string | null;
  load: (search?: string, options?: { silent?: boolean; force?: boolean }) => Promise<void>;
  ensureWorkspace: (workspaceId: string) => void;
  setSearch: (workspaceId: string, search: string) => void;
  selectTransfer: (
    workspaceId: string,
    id: number,
    options?: { toggle?: boolean; range?: boolean; visibleTransferIds?: number[] },
  ) => void;
  toggleProviderFilter: (workspaceId: string, provider: string) => void;
  toggleTypeFilter: (workspaceId: string, type: TransferType) => void;
  setLocationScope: (workspaceId: string, scope: TransferLocationScope) => void;
  setStatusFilter: (workspaceId: string, filter: TransferStatusFilter) => void;
  setSort: (workspaceId: string, key: TransferSortKey, direction?: TransferSortDirection) => void;
  setPageIndex: (workspaceId: string, pageIndex: number) => void;
  clearFilters: (workspaceId: string) => void;
  setFocusedTransfer: (workspaceId: string, id: number | null) => void;
  deleteIds: (workspaceId: string, ids: number[]) => Promise<void>;
  deleteSelected: (workspaceId: string) => Promise<void>;
  deleteAll: () => Promise<void>;
}
