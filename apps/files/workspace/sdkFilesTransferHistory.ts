import { create } from "zustand";
import type { MistyAppSDK } from "@misty/sdk";
import type { SdkFilesStore } from "./sdkFilesStore";

type Transfer = ReturnType<SdkFilesStore["store"]["getState"]>["transfers"][number];
export type FilesTransferRecord = Transfer & { updatedAt: number };
const prefix = "files.transfer-history.v1.";
const live = (row: Transfer) => row.status === "running" || row.status === "queued";

/** Constructed by the host-scoped component session, never a module singleton.
 * Stored records contain presentation data; live operations retain their originating view's grants. */
export function createSdkFilesTransferHistory() {
  const store = create(() => ({ rows: [] as FilesTransferRecord[], error: "" }));
  const owners = new Map<string, SdkFilesStore>();
  let closed = false;
  const merge = (rows: FilesTransferRecord[]) => {
    if (closed) return;
    store.setState((state) => {
      const next = new Map(state.rows.map(row => [row.id, row]));
      for (const row of rows) {
        const previous = next.get(row.id);
        if (!previous || row.updatedAt >= previous.updatedAt) next.set(row.id, row);
      }
      return { rows: [...next.values()].sort((a, b) => b.updatedAt - a.updatedAt) };
    });
  };
  return {
    store,
    async register(files: SdkFilesStore, misty: MistyAppSDK, signal: AbortSignal) {
      let detached = false;
      let writes = Promise.resolve();
      const persist = (row: FilesTransferRecord) => {
        writes = writes.then(async () => {
          if (!signal.aborted && !closed)
            await misty.storage.local.set(prefix + row.id, row);
        }).catch(error => {
          if (!signal.aborted && !closed) store.setState({ error: String(error) });
        });
      };
      const update = (rows: Transfer[], previous: Transfer[]) => {
        const old = new Map(previous.map(row => [row.id, row]));
        for (const row of rows) {
          if (old.get(row.id) === row) continue;
          owners.set(row.id, files);
          const record = { ...row, updatedAt: Date.now() };
          merge([record]);
          // Progress remains live in memory; persist start and terminal outcomes.
          if (!old.has(row.id) || !live(row)) persist(record);
        }
      };
      update(files.store.getState().transfers, []);
      const unsubscribe = files.store.subscribe((state, previous) =>
        update(state.transfers, previous.transfers),
      );
      const detach = () => {
        if (detached) return;
        detached = true;
        unsubscribe();
        signal.removeEventListener("abort", detach);
        for (const [id, owner] of owners) {
          if (owner !== files) continue;
          owners.delete(id);
          const row = store.getState().rows.find(row => row.id === id);
          if (row && live(row)) {
            const cancelled = { ...row, status: "cancelled" as const, message: "The originating Files view closed.", updatedAt: Date.now() };
            merge([cancelled]);
            persist(cancelled);
          }
        }
        return writes;
      };
      signal.addEventListener("abort", detach, { once: true });
      try {
        const keys = await misty.storage.local.keys();
        for (const key of keys.filter(key => key.startsWith(prefix))) {
          if (signal.aborted || closed || detached) break;
          const row = await misty.storage.local.get(key) as FilesTransferRecord | null;
          if (!row || key !== prefix + row.id || !/^[0-9a-f-]{36}$/.test(row.id) ||
              typeof row.name !== "string" || row.name.length > 1024 ||
              typeof row.message !== "string" || row.message.length > 8192 ||
              !Number.isSafeInteger(row.bytes) || row.bytes < 0 ||
              !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0 ||
              !["queued", "running", "completed", "failed", "cancelled"].includes(row.status)) continue;
          if (owners.has(row.id)) continue;
          merge([{ ...row, ...(live(row) ? { status: "cancelled" as const, message: "The originating Files view closed." } : {}) }]);
        }
      } catch (error) {
        if (!signal.aborted && !closed) store.setState({ error: String(error) });
      }
      if (signal.aborted || closed) detach();
      return detach;
    },
    canRetry(id: string) { return owners.has(id); },
    cancel(id: string) { owners.get(id)?.cancelTransfer(id); },
    async retry(id: string) {
      const owner = owners.get(id);
      if (!owner) throw new Error("Reopen the source and destination folders to retry this transfer.");
      await owner.retryTransfer(id);
    },
    async remove(id: string, misty: MistyAppSDK) {
      const row = store.getState().rows.find(row => row.id === id);
      if (!row || live(row)) return;
      await misty.storage.local.delete(prefix + id);
      owners.delete(id);
      store.setState(state => ({ rows: state.rows.filter(row => row.id !== id) }));
    },
    close() { closed = true; owners.clear(); store.setState({ rows: [], error: "" }); },
  };
}
export type SdkFilesTransferHistory = ReturnType<typeof createSdkFilesTransferHistory>;
