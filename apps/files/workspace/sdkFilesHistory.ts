import { create } from "zustand";

export interface SdkFilesHistoryEntry {
  title: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

/** Records completed operations only; a failed undo stays available for retry. */
export function createSdkFilesHistory(signal: AbortSignal) {
  const store = create(() => ({ undo: [] as SdkFilesHistoryEntry[], redo: [] as SdkFilesHistoryEntry[], busy: false }));
  let replaying = false;
  const assert = () => {
    if (signal.aborted) throw new Error("This Files history is closed.");
  };
  return {
    store,
    record(entry: SdkFilesHistoryEntry) {
      assert();
      if (!replaying) store.setState(state => ({ undo: [...state.undo.slice(-99), entry], redo: [] }));
    },
    async run(direction: "undo" | "redo") {
      assert();
      if (replaying) throw new Error("Wait for the current file operation to finish.");
      const entry = store.getState()[direction].slice(-1)[0];
      if (!entry) return;
      replaying = true;
      store.setState({ busy: true });
      try {
        await entry[direction]();
        assert();
        const other = direction === "undo" ? "redo" : "undo";
        store.setState(state => ({ [direction]: state[direction].slice(0, -1), [other]: [...state[other], entry] }));
      } finally {
        replaying = false;
        store.setState({ busy: false });
      }
    },
  };
}
