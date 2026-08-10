import { selectGeneralPreferences, useSettingsStore } from "@/features/settings";
import { transfersDeleteAll, transfersDeleteSelected, transfersSnapshot } from "@/services/backend";
import { errorText } from "@/shared/lib/format";
import { create } from "zustand";
import type { TransferSortDirection } from "../model/stores/transfers/types/useTransfersStore";
import {
  createTransferWorkspaceState,
  pruneWorkspaces,
  transferPagesEqual,
  updateWorkspace,
  withWorkspace,
  type TransfersStore,
} from "./transferStoreHelpers";
export type {
  TransferLocationScope,
  TransferSortDirection,
  TransferSortKey,
  TransferStatusFilter,
} from "../model/stores/transfers/types/useTransfersStore";

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

export * from "./transferStoreHelpers";
