import { create } from "zustand";
import {
  operationQueueCancel,
  operationQueueClearTerminal,
  operationQueueResolveConflict,
  operationQueueRetry,
  operationQueueSnapshot,
} from "../../api/misty";
import type { OperationConflictPolicy, OperationQueueSnapshot } from "../../api/types";
import { errorText } from "../../shared/format";

let silentOperationQueueLoadInFlight = false;

interface OperationQueueStore {
  snapshot: OperationQueueSnapshot | null;
  working: boolean;
  error: string | null;
  load: (options?: { silent?: boolean }) => Promise<void>;
  cancel: (operationId: number) => Promise<void>;
  retry: (operationId: number) => Promise<void>;
  resolveConflict: (operationId: number, policy: OperationConflictPolicy, applyToBatch: boolean) => Promise<void>;
  clearTerminal: () => Promise<void>;
}

export const useOperationQueueStore = create<OperationQueueStore>((set) => ({
  snapshot: null,
  working: false,
  error: null,

  load: async (options = {}) => {
    if (options.silent && silentOperationQueueLoadInFlight) return;
    if (options.silent) silentOperationQueueLoadInFlight = true;
    if (!options.silent) set({ working: true, error: null });
    try {
      const next = await operationQueueSnapshot();
      set((state) => ({
        snapshot: operationQueueSnapshotsEqual(state.snapshot, next) ? state.snapshot : next,
      }));
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      if (options.silent) silentOperationQueueLoadInFlight = false;
      if (!options.silent) set({ working: false });
    }
  },

  cancel: async (operationId) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueCancel(operationId) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  retry: async (operationId) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueRetry(operationId) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  resolveConflict: async (operationId, policy, applyToBatch) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueResolveConflict(operationId, policy, applyToBatch) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  clearTerminal: async () => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueClearTerminal() });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },
}));

function operationQueueSnapshotsEqual(left: OperationQueueSnapshot | null, right: OperationQueueSnapshot): boolean {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}
