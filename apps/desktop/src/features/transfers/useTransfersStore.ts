import { create } from "zustand";
import { transfersDeleteAll, transfersDeleteSelected, transfersSnapshot } from "../../api/misty";
import type { TransferPage } from "../../api/types";
import { errorText } from "../../shared/format";

interface TransfersStore {
  transfers: TransferPage | null;
  search: string;
  selectedIds: Set<number>;
  working: boolean;
  error: string | null;
  message: string | null;
  load: (search?: string) => Promise<void>;
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

  load: async (search = get().search) => {
    set({ working: true, error: null });
    try {
      const next = await transfersSnapshot({ search, limit: 100 });
      const visibleIds = new Set(next.rows.map((row) => row.id));
      set((state) => ({
        transfers: next,
        selectedIds: new Set([...state.selectedIds].filter((id) => visibleIds.has(id))),
      }));
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
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
