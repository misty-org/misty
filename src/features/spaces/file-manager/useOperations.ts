import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@misty/ui";
import { disk, fileEvents, onFilesEvent, type Progress as FilesProgress, type UndoState } from "@/features/files";
import { messageOf } from "./format";

const newOpId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * The one long operation that may run at a time (a copy, a move, a compress, a search for duplicates),
 * with its progress from `files://progress` for the bottom bar and Cancel. It isn't a queue: a second one
 * waits for the first to end.
 */
export function useFilesOperation() {
  const [progress, setProgress] = useState<FilesProgress | null>(null);
  const current = useRef<string | null>(null);

  useEffect(
    () =>
      onFilesEvent<FilesProgress>(fileEvents.progress, (next) => {
        if (next.opId === current.current) setProgress(next);
      }),
    [],
  );

  const run = useCallback(async <T,>(label: string, work: (opId: string) => Promise<T>): Promise<T> => {
    const opId = newOpId();
    current.current = opId;
    setProgress({ opId, label, doneBytes: 0, totalBytes: 0 });
    try {
      return await work(opId);
    } finally {
      if (current.current === opId) {
        current.current = null;
        setProgress(null);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    const opId = current.current;
    if (opId) void disk.cancel(opId).catch(() => undefined);
  }, []);

  return { progress, busy: progress !== null, run, cancel };
}

/** What Undo and Redo would do now, read again after every change Files makes. */
export function useUndoState(on: boolean) {
  const [state, setState] = useState<UndoState>({});
  const refresh = useCallback(() => {
    if (!on) return;
    void disk.undoState().then(setState, () => undefined);
  }, [on]);
  useEffect(refresh, [refresh]);
  const step = useCallback(
    async (which: "undo" | "redo") => {
      try {
        setState(await (which === "undo" ? disk.undo() : disk.redo()));
      } catch (cause) {
        notify({ message: messageOf(cause, `Couldn't ${which}.`), tone: "error" });
        refresh();
      }
    },
    [refresh],
  );
  return { state, refresh, undo: () => step("undo"), redo: () => step("redo") };
}
