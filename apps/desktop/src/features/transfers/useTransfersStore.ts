import { create } from "zustand";
import { transfersDeleteAll, transfersDeleteSelected, transfersSnapshot } from "../../api/misty";
import type { TransferPage } from "../../api/types";
import { errorText } from "../../shared/format";

let silentTransferLoadInFlight = false;

interface TransfersStore {
  transfers: TransferPage | null;
  search: string;
  selectedIds: Set<number>;
  working: boolean;
  error: string | null;
  message: string | null;
  load: (search?: string, options?: { silent?: boolean }) => Promise<void>;
  setSearch: (search: string) => void;
  toggleTransfer: (id: number, checked: boolean) => void;
  deleteSelected: () => Promise<void>;
  deleteAll: () => Promise<void>;
}

export const useTransfersStore = create<TransfersStore>((set, get) => ({
  transfers: null,
  search: "",
  selectedIds: new Set(),
  working: false,
  error: null,
  message: null,

  load: async (search = get().search, options = {}) => {
    if (options.silent && silentTransferLoadInFlight) return;
    if (options.silent) silentTransferLoadInFlight = true;
    if (!options.silent) set({ working: true, error: null });
    try {
      const next = await transfersSnapshot({ search, limit: 100 });
      const visibleIds = new Set(next.rows.map((row) => row.id));
      set((state) => ({
        transfers: transferPagesEqual(state.transfers, next) ? state.transfers : next,
        selectedIds: pruneSelectedIds(state.selectedIds, visibleIds),
      }));
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      if (options.silent) silentTransferLoadInFlight = false;
      if (!options.silent) set({ working: false });
    }
  },

  setSearch: (search) => {
    set({ search });
    void get().load(search);
  },

  toggleTransfer: (id, checked) => {
    set((state) => {
      const selectedIds = new Set(state.selectedIds);
      if (checked) selectedIds.add(id);
      else selectedIds.delete(id);
      return { selectedIds };
    });
  },

  deleteSelected: async () => {
    const ids = [...get().selectedIds];
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Delete ${ids.length} selected transfer history ${ids.length === 1 ? "row" : "rows"}? Active file operations are not canceled.`,
      )
    ) {
      return;
    }
    set({ working: true, error: null, message: null });
    try {
      await transfersDeleteSelected(ids);
      set({ selectedIds: new Set(), message: "Selected transfer history deleted." });
      await get().load();
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  deleteAll: async () => {
    if (!window.confirm("Delete all transfer history? This ignores current filters and does not cancel active file operations.")) {
      return;
    }
    set({ working: true, error: null, message: null });
    try {
      await transfersDeleteAll();
      set({ selectedIds: new Set(), message: "All transfer history deleted." });
      await get().load();
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },
}));

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
