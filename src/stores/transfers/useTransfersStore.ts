import type {
  TransferLocationScope,
  TransferStatusFilter,
  TransferSortKey,
  TransferSortDirection,
} from "@/models/types/stores/transfers/useTransfersStore";
export type {
  TransferLocationScope,
  TransferStatusFilter,
  TransferSortKey,
  TransferSortDirection,
} from "@/models/types/stores/transfers/useTransfersStore";
import { create } from "zustand";
import { transfersDeleteAll, transfersDeleteSelected, transfersSnapshot } from "@/stores/backend";
import type { TransferStatus, TransferType } from "@/models/types/services/misty-api";
import type { TransferPage } from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";
import { selectGeneralPreferences, useSettingsStore } from "@/stores/app";

let silentTransferLoadInFlight = false;
export const TRANSFERS_PAGE_SIZE = 25;

export const useTransfersStore = create<TransfersStore>((set, get) => ({
  transfers: null,
  workspaces: {},
  working: false,
  error: null,
  message: null,

  load: async (search = "", options = {}) => {
    if (options.silent && silentTransferLoadInFlight && !options.force) return;
    if (options.silent) silentTransferLoadInFlight = true;
    if (!options.silent) set({ working: true, error: null });
    try {
      const next = await transfersSnapshot({ search, limit: 5000 });
      const visibleIds = new Set(next.rows.map((row) => row.id));
      set((state) => {
        const transfers = transferPagesEqual(state.transfers, next) ? state.transfers : next;
        const workspaces = pruneWorkspaces(state.workspaces, visibleIds);
        if (transfers === state.transfers && workspaces === state.workspaces) {
          return state;
        }
        return { transfers, workspaces };
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      if (options.silent) silentTransferLoadInFlight = false;
      if (!options.silent) set({ working: false });
    }
  },

  ensureWorkspace: (workspaceId) => {
    if (!workspaceId) return;
    set((state) =>
      state.workspaces[workspaceId]
        ? state
        : { workspaces: { ...state.workspaces, [workspaceId]: createTransferWorkspaceState() } },
    );
  },

  setSearch: (workspaceId, search) => {
    updateWorkspace(set, workspaceId, (workspace) =>
      workspace.search === search ? workspace : { ...workspace, search, pageIndex: 0 },
    );
  },

  selectTransfer: (workspaceId, id, options = {}) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
      let selectedIds: Set<number>;
      if (options.range && options.visibleTransferIds?.length) {
        const visibleTransferIds = options.visibleTransferIds;
        const targetIndex = visibleTransferIds.indexOf(id);
        const anchorId = workspace.lastSelectedId ?? id;
        const anchorIndex = visibleTransferIds.indexOf(anchorId);
        const anchor = anchorIndex >= 0 ? anchorIndex : targetIndex;
        const target = targetIndex >= 0 ? targetIndex : anchor;
        const start = Math.min(anchor, target);
        const end = Math.max(anchor, target);
        selectedIds = new Set(visibleTransferIds.slice(start, end + 1));
      } else if (options.toggle) {
        selectedIds = new Set(workspace.selectedIds);
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
      } else {
        selectedIds = new Set([id]);
      }
      return withWorkspace(state, workspaceId, {
        ...workspace,
        selectedIds,
        focusedTransferId: id,
        lastSelectedId: id,
      });
    });
  },

  toggleProviderFilter: (workspaceId, provider) => {
    if (!provider) return;
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
      const providerFilters = new Set(workspace.providerFilters);
      if (providerFilters.has(provider)) providerFilters.delete(provider);
      else providerFilters.add(provider);
      return withWorkspace(state, workspaceId, {
        ...workspace,
        providerFilters,
        selectedIds: new Set(),
        focusedTransferId: null,
        lastSelectedId: null,
        pageIndex: 0,
      });
    });
  },

  toggleTypeFilter: (workspaceId, type) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
      const typeFilters = new Set(workspace.typeFilters);
      if (typeFilters.has(type)) typeFilters.delete(type);
      else typeFilters.add(type);
      return withWorkspace(state, workspaceId, {
        ...workspace,
        typeFilters,
        selectedIds: new Set(),
        focusedTransferId: null,
        lastSelectedId: null,
        pageIndex: 0,
      });
    });
  },

  setLocationScope: (workspaceId, locationScope) => {
    updateWorkspace(set, workspaceId, (workspace) =>
      workspace.locationScope === locationScope
        ? workspace
        : {
            ...workspace,
            locationScope,
            selectedIds: new Set(),
            focusedTransferId: null,
            lastSelectedId: null,
            pageIndex: 0,
          },
    );
  },

  setStatusFilter: (workspaceId, statusFilter) => {
    updateWorkspace(set, workspaceId, (workspace) =>
      workspace.statusFilter === statusFilter
        ? workspace
        : {
            ...workspace,
            statusFilter,
            selectedIds: new Set(),
            focusedTransferId: null,
            lastSelectedId: null,
            pageIndex: 0,
          },
    );
  },

  setSort: (workspaceId, sortKey, direction) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
      let nextSortKey = sortKey;
      let sortDirection: TransferSortDirection = direction ?? "asc";
      if (!direction) {
        if (workspace.sortKey !== sortKey) {
          sortDirection = "asc";
        } else if (workspace.sortDirection === "asc") {
          sortDirection = "desc";
        } else {
          nextSortKey = "none";
          sortDirection = "asc";
        }
      }
      if (nextSortKey === "none") sortDirection = "asc";
      if (workspace.sortKey === nextSortKey && workspace.sortDirection === sortDirection)
        return state;
      return withWorkspace(state, workspaceId, {
        ...workspace,
        sortKey: nextSortKey,
        sortDirection,
        pageIndex: 0,
      });
    });
  },

  setPageIndex: (workspaceId, pageIndex) =>
    set((state) => {
      const normalized = Math.max(0, Math.floor(pageIndex));
      const workspace = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
      return workspace.pageIndex === normalized
        ? state
        : withWorkspace(state, workspaceId, { ...workspace, pageIndex: normalized });
    }),

  clearFilters: (workspaceId) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
      if (
        workspace.providerFilters.size === 0 &&
        workspace.typeFilters.size === 0 &&
        workspace.locationScope === "all" &&
        workspace.statusFilter === "all"
      ) {
        return state;
      }
      return withWorkspace(state, workspaceId, {
        ...workspace,
        providerFilters: new Set(),
        typeFilters: new Set(),
        locationScope: "all",
        statusFilter: "all",
        selectedIds: new Set(),
        focusedTransferId: null,
        lastSelectedId: null,
        pageIndex: 0,
      });
    });
  },

  setFocusedTransfer: (workspaceId, focusedTransferId) => {
    updateWorkspace(set, workspaceId, (workspace) =>
      workspace.focusedTransferId === focusedTransferId
        ? workspace
        : { ...workspace, focusedTransferId },
    );
  },

  deleteIds: async (workspaceId, idsInput) => {
    const ids = [...new Set(idsInput)].filter((id) => Number.isFinite(id));
    if (ids.length === 0) return;
    const shouldConfirm = selectGeneralPreferences(
      useSettingsStore.getState().settings?.document,
    ).confirmDestructiveActions;
    if (
      shouldConfirm &&
      !window.confirm(
        `Delete ${ids.length} transfer history ${ids.length === 1 ? "row" : "rows"}? Active file operations are not canceled.`,
      )
    ) {
      return;
    }
    set({ working: true, error: null, message: null });
    try {
      await transfersDeleteSelected(ids);
      const deletedIds = new Set(ids);
      set((state) => ({
        ...withWorkspace(state, workspaceId, {
          ...(state.workspaces[workspaceId] ?? createTransferWorkspaceState()),
          selectedIds: new Set(
            [...(state.workspaces[workspaceId]?.selectedIds ?? [])].filter(
              (id) => !deletedIds.has(id),
            ),
          ),
          focusedTransferId: deletedIds.has(state.workspaces[workspaceId]?.focusedTransferId ?? -1)
            ? null
            : (state.workspaces[workspaceId]?.focusedTransferId ?? null),
          lastSelectedId: deletedIds.has(state.workspaces[workspaceId]?.lastSelectedId ?? -1)
            ? null
            : (state.workspaces[workspaceId]?.lastSelectedId ?? null),
        }),
        message:
          ids.length === 1 ? "Transfer history row deleted." : "Transfer history rows deleted.",
      }));
      await get().load();
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  deleteSelected: async (workspaceId) => {
    const ids = [...(get().workspaces[workspaceId]?.selectedIds ?? new Set<number>())];
    await get().deleteIds(workspaceId, ids);
  },

  deleteAll: async () => {
    const shouldConfirm = selectGeneralPreferences(
      useSettingsStore.getState().settings?.document,
    ).confirmDestructiveActions;
    if (
      shouldConfirm &&
      !window.confirm(
        "Delete all transfer history? This ignores current filters and does not cancel active file operations.",
      )
    ) {
      return;
    }
    set({ working: true, error: null, message: null });
    try {
      await transfersDeleteAll();
      set((state) => ({
        workspaces: Object.fromEntries(
          Object.entries(state.workspaces).map(([key, workspace]) => [
            key,
            {
              ...workspace,
              selectedIds: new Set(),
              pageIndex: 0,
              focusedTransferId: null,
              lastSelectedId: null,
            },
          ]),
        ),
        message: "All transfer history deleted.",
      }));
      await get().load();
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },
}));

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

function updateWorkspace(
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

function withWorkspace(
  state: Pick<TransfersStore, "workspaces">,
  workspaceId: string,
  workspace: TransferWorkspaceState,
): Partial<TransfersStore> {
  if (!workspaceId) return {};
  return { workspaces: { ...state.workspaces, [workspaceId]: workspace } };
}

function pruneWorkspaces(
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

function pruneSelectedIds(selectedIds: Set<number>, visibleIds: Set<number>): Set<number> {
  const next = new Set([...selectedIds].filter((id) => visibleIds.has(id)));
  if (next.size !== selectedIds.size) return next;
  for (const id of next) {
    if (!selectedIds.has(id)) return next;
  }
  return selectedIds;
}

function transferPagesEqual(left: TransferPage | null, right: TransferPage): boolean {
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

function transferRowsEqual(
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
