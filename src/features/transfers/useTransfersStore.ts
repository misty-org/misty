import { create } from "zustand";
import { transfersDeleteAll, transfersDeleteSelected, transfersSnapshot } from "../../api/misty";
import type { TransferPage, TransferStatus, TransferType } from "../../api/types";
import { errorText } from "../../shared/format";
import { selectGeneralPreferences, useSettingsStore } from "../settings/useSettingsStore";

let silentTransferLoadInFlight = false;

export type TransferLocationScope = "all" | "local" | "remote";
export type TransferStatusFilter = "all" | "active" | "completed" | "failed";
export type TransferSortKey = "time" | "name" | "operation" | "status";
export type TransferSortDirection = "asc" | "desc";
export const TRANSFERS_PAGE_SIZE = 25;

export interface TransferWorkspaceState {
  search: string;
  selectedIds: Set<number>;
  providerFilters: Set<string>;
  typeFilters: Set<TransferType>;
  locationScope: TransferLocationScope;
  statusFilter: TransferStatusFilter;
  sortKey: TransferSortKey;
  sortDirection: TransferSortDirection;
  pageIndex: number;
  focusedTransferId: number | null;
}

interface TransfersStore {
  transfers: TransferPage | null;
  workspaces: Record<string, TransferWorkspaceState>;
  working: boolean;
  error: string | null;
  message: string | null;
  load: (search?: string, options?: { silent?: boolean }) => Promise<void>;
  ensureWorkspace: (workspaceId: string) => void;
  setSearch: (workspaceId: string, search: string) => void;
  toggleTransfer: (workspaceId: string, id: number, checked: boolean) => void;
  setTransfersSelected: (workspaceId: string, ids: number[], checked: boolean) => void;
  toggleProviderFilter: (workspaceId: string, provider: string) => void;
  toggleTypeFilter: (workspaceId: string, type: TransferType) => void;
  setLocationScope: (workspaceId: string, scope: TransferLocationScope) => void;
  setStatusFilter: (workspaceId: string, filter: TransferStatusFilter) => void;
  setSort: (workspaceId: string, key: TransferSortKey, direction?: TransferSortDirection) => void;
  setPageIndex: (workspaceId: string, pageIndex: number) => void;
  clearFilters: (workspaceId: string) => void;
  setFocusedTransfer: (workspaceId: string, id: number | null) => void;
  deleteSelected: (workspaceId: string) => Promise<void>;
  deleteAll: () => Promise<void>;
}

export const useTransfersStore = create<TransfersStore>((set, get) => ({
  transfers: null,
  workspaces: {},
  working: false,
  error: null,
  message: null,

  load: async (search = "", options = {}) => {
    if (options.silent && silentTransferLoadInFlight) return;
    if (options.silent) silentTransferLoadInFlight = true;
    if (!options.silent) set({ working: true, error: null });
    try {
      const next = await transfersSnapshot({ search, limit: 500 });
      const visibleIds = new Set(next.rows.map((row) => row.id));
      set((state) => {
        const transfers = transferPagesEqual(state.transfers, next) ? state.transfers : next;
        const workspaces = pruneWorkspaces(state.workspaces, visibleIds);
        if (
          transfers === state.transfers
          && workspaces === state.workspaces
        ) {
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
    set((state) => state.workspaces[workspaceId]
      ? state
      : { workspaces: { ...state.workspaces, [workspaceId]: createTransferWorkspaceState() } });
  },

  setSearch: (workspaceId, search) => {
    updateWorkspace(set, workspaceId, (workspace) =>
      workspace.search === search ? workspace : { ...workspace, search, pageIndex: 0 });
  },

  toggleTransfer: (workspaceId, id, checked) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
      const selectedIds = new Set(workspace.selectedIds);
      if (checked) selectedIds.add(id);
      else selectedIds.delete(id);
      return withWorkspace(state, workspaceId, { ...workspace, selectedIds });
    });
  },

  setTransfersSelected: (workspaceId, ids, checked) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
      const selectedIds = new Set(workspace.selectedIds);
      for (const id of ids) {
        if (checked) selectedIds.add(id);
        else selectedIds.delete(id);
      }
      return withWorkspace(state, workspaceId, { ...workspace, selectedIds });
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
        pageIndex: 0,
      });
    });
  },

  setLocationScope: (workspaceId, locationScope) => {
    updateWorkspace(set, workspaceId, (workspace) => workspace.locationScope === locationScope
      ? workspace
      : { ...workspace, locationScope, selectedIds: new Set(), focusedTransferId: null, pageIndex: 0 });
  },

  setStatusFilter: (workspaceId, statusFilter) => {
    updateWorkspace(set, workspaceId, (workspace) => workspace.statusFilter === statusFilter
      ? workspace
      : { ...workspace, statusFilter, selectedIds: new Set(), focusedTransferId: null, pageIndex: 0 });
  },

  setSort: (workspaceId, sortKey, direction) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
      const sortDirection = direction ?? (workspace.sortKey === sortKey && workspace.sortDirection === "asc" ? "desc" : "asc");
      if (workspace.sortKey === sortKey && workspace.sortDirection === sortDirection) return state;
      return withWorkspace(state, workspaceId, { ...workspace, sortKey, sortDirection, pageIndex: 0 });
    });
  },

  setPageIndex: (workspaceId, pageIndex) => set((state) => {
    const normalized = Math.max(0, Math.floor(pageIndex));
    const workspace = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
    return workspace.pageIndex === normalized ? state : withWorkspace(state, workspaceId, { ...workspace, pageIndex: normalized });
  }),

  clearFilters: (workspaceId) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? createTransferWorkspaceState();
      if (
        workspace.providerFilters.size === 0
        && workspace.typeFilters.size === 0
        && workspace.locationScope === "all"
        && workspace.statusFilter === "all"
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
        pageIndex: 0,
      });
    });
  },

  setFocusedTransfer: (workspaceId, focusedTransferId) => {
    updateWorkspace(set, workspaceId, (workspace) =>
      workspace.focusedTransferId === focusedTransferId ? workspace : { ...workspace, focusedTransferId });
  },

  deleteSelected: async (workspaceId) => {
    const ids = [...(get().workspaces[workspaceId]?.selectedIds ?? new Set<number>())];
    if (ids.length === 0) return;
    const shouldConfirm = selectGeneralPreferences(useSettingsStore.getState().settings?.document).confirmDestructiveActions;
    if (
      shouldConfirm &&
      !window.confirm(
        `Delete ${ids.length} selected transfer history ${ids.length === 1 ? "row" : "rows"}? Active file operations are not canceled.`,
      )
    ) {
      return;
    }
    set({ working: true, error: null, message: null });
    try {
      await transfersDeleteSelected(ids);
      set((state) => ({
        ...withWorkspace(state, workspaceId, {
        ...(state.workspaces[workspaceId] ?? createTransferWorkspaceState()),
        selectedIds: new Set(),
        }),
        message: "Selected transfer history deleted.",
      }));
      await get().load();
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  deleteAll: async () => {
    const shouldConfirm = selectGeneralPreferences(useSettingsStore.getState().settings?.document).confirmDestructiveActions;
    if (
      shouldConfirm &&
      !window.confirm("Delete all transfer history? This ignores current filters and does not cancel active file operations.")
    ) {
      return;
    }
    set({ working: true, error: null, message: null });
    try {
      await transfersDeleteAll();
      set((state) => ({
        workspaces: Object.fromEntries(Object.entries(state.workspaces).map(([key, workspace]) => [
          key,
          { ...workspace, selectedIds: new Set(), pageIndex: 0, focusedTransferId: null },
        ])),
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

export const transferTypes: TransferType[] = ["upload", "download", "create", "copy", "move", "rename", "delete"];

export function activeTransferFilterCount(state: Pick<
  TransferWorkspaceState,
  "providerFilters" | "typeFilters" | "locationScope" | "statusFilter"
>): number {
  return state.providerFilters.size
    + state.typeFilters.size
    + (state.locationScope === "all" ? 0 : 1)
    + (state.statusFilter === "all" ? 0 : 1);
}

export function createTransferWorkspaceState(): TransferWorkspaceState {
  return {
    search: "",
    selectedIds: new Set(),
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
  set: (partial: Partial<TransfersStore> | TransfersStore | ((state: TransfersStore) => Partial<TransfersStore> | TransfersStore)) => void,
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
  const next = Object.fromEntries(Object.entries(workspaces).map(([workspaceId, workspace]) => {
    const selectedIds = pruneSelectedIds(workspace.selectedIds, visibleIds);
    const focusedTransferId = workspace.focusedTransferId == null || visibleIds.has(workspace.focusedTransferId)
      ? workspace.focusedTransferId
      : null;
    if (selectedIds !== workspace.selectedIds || focusedTransferId !== workspace.focusedTransferId) {
      changed = true;
      return [workspaceId, { ...workspace, selectedIds, focusedTransferId }];
    }
    return [workspaceId, workspace];
  }));
  return changed ? next : workspaces;
}

export function transferStatusMatchesFilter(status: TransferStatus, filter: TransferStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "completed") return status === "completed";
  if (filter === "failed") return status === "failed" || status === "interrupted";
  return status === "queued" || status === "pending" || status === "in_progress" || status === "waiting_for_resolution";
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
  if (left.totalCount !== right.totalCount || left.dbPath !== right.dbPath || left.rows.length !== right.rows.length) {
    return false;
  }
  return left.rows.every((row, index) => transferRowsEqual(row, right.rows[index]));
}

function transferRowsEqual(left: TransferPage["rows"][number], right: TransferPage["rows"][number]): boolean {
  return left.id === right.id
    && left.jobId === right.jobId
    && left.transferType === right.transferType
    && left.itemType === right.itemType
    && left.status === right.status
    && left.conflictPolicy === right.conflictPolicy
    && left.fileName === right.fileName
    && left.localSourcePath === right.localSourcePath
    && left.localDestPath === right.localDestPath
    && left.remoteSourceName === right.remoteSourceName
    && left.remoteSourcePath === right.remoteSourcePath
    && left.remoteDestName === right.remoteDestName
    && left.remoteDestPath === right.remoteDestPath
    && left.totalBytes === right.totalBytes
    && left.transferredBytes === right.transferredBytes
    && left.errorMessage === right.errorMessage
    && left.detailMessage === right.detailMessage
    && left.queuedAtMs === right.queuedAtMs
    && left.startedAtMs === right.startedAtMs
    && left.completedAtMs === right.completedAtMs
    && left.cancelable === right.cancelable
    && left.retryable === right.retryable
    && left.undoable === right.undoable
    && left.undoTokenId === right.undoTokenId;
}
