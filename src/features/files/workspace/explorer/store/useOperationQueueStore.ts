import { operationQueueSnapshot, transfersSnapshot } from "@/native/transfers-tools";
import type { OperationQueueSnapshot, TransferRecord } from "@/native/ipc";
import { errorText } from "@/shared/lib/format";
import { create } from "zustand";

let loading = false;
export const useOperationQueueStore = create<{
  snapshot: OperationQueueSnapshot | null;
  latestUndoable: TransferRecord | null;
  working: boolean;
  error: string | null;
  load: (options?: { silent?: boolean }) => Promise<void>;
}>((set) => ({
  snapshot: null,
  latestUndoable: null,
  working: false,
  error: null,
  load: async (options = {}) => {
    if (loading) return;
    loading = true;
    if (!options.silent) set({ working: true, error: null });
    try {
      // The native operation journal still supplies undo tokens for file edits.
      const [snapshot, history] = await Promise.all([
        operationQueueSnapshot(),
        transfersSnapshot({ limit: 500 }),
      ]);
      const latestUndoable =
        history.rows
          .filter((row) => row.undoable && row.undoTokenId > 0 && row.status === "completed")
          .sort(
            (left, right) =>
              (right.completedAtMs || right.startedAtMs || right.queuedAtMs || right.id) -
                (left.completedAtMs || left.startedAtMs || left.queuedAtMs || left.id) ||
              right.id - left.id,
          )[0] ?? null;
      set({ snapshot, latestUndoable });
    } catch (error) {
      if (!options.silent) set({ error: errorText(error) });
    } finally {
      loading = false;
      if (!options.silent) set({ working: false });
    }
  },
}));
