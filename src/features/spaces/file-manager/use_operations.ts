import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@misty/ui";
import {
  disk,
  fileEvents,
  onFilesEvent,
  type Progress as FilesProgress,
  type UndoState,
} from "@/features/files";
import { messageOf } from "./format";
import { cancelTransfer, endTurn, useTransfers, waitTurn, type TransferWhere } from "./transfers";

const newOpId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useFilesOperation() {
  const [progress, setProgress] = useState<FilesProgress | null>(null);
  const current = useRef<string | null>(null);

  useEffect(
    () =>
      onFilesEvent<FilesProgress>(fileEvents.progress, (next) => {
        if (next.opId === current.current) setProgress(next);
        useTransfers.getState().update(next.opId, {
          doneBytes: next.doneBytes,
          totalBytes: next.totalBytes,
          item: next.item,
        });
      }),
    [],
  );

  const run = useCallback(
    async <T>(
      label: string,
      work: (opId: string) => Promise<T>,
      where?: TransferWhere,
    ): Promise<T> => {
      const opId = newOpId();
      current.current = opId;
      setProgress({ opId, label, doneBytes: 0, totalBytes: 0 });
      useTransfers.getState().add({
        opId,
        label,
        ...where,
        queuedAt: Date.now(),
        state: "queued",
        doneBytes: 0,
        totalBytes: 0,
      });
      const retry = () => void run(label, work, where).catch(() => undefined);
      try {
        await waitTurn(opId);
        const result = await work(opId);
        const stopped = useTransfers
          .getState()
          .list.some((each) => each.opId === opId && each.cancelling);
        useTransfers.getState().update(opId, {
          state: stopped ? "cancelled" : "done",
          endedAt: Date.now(),
          item: undefined,
          retry,
        });
        return result;
      } catch (cause) {
        const stopped = useTransfers
          .getState()
          .list.some((each) => each.opId === opId && each.cancelling);
        useTransfers.getState().update(opId, {
          state: stopped ? "cancelled" : "failed",
          endedAt: Date.now(),
          error: stopped ? undefined : messageOf(cause, `${label} didn't finish.`),
          retry,
        });
        throw cause;
      } finally {
        endTurn(opId);
        if (current.current === opId) {
          current.current = null;
          setProgress(null);
        }
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    const opId = current.current;
    if (opId) cancelTransfer(opId);
  }, []);

  return { progress, busy: progress !== null, run, cancel };
}

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
