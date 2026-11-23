import { useEffect } from "react";
import { create } from "zustand";
import { notify } from "@misty/ui";
import { disk, type Failure, type TransferResult, type UndoState } from "@/features/files";
import { messageOf } from "./format";
import { cancelTransfer, endTurn, useTransfers, waitTurn, type TransferWhere } from "./transfers";

export type Run = <T>(
  label: string,
  work: (opId: string) => Promise<T>,
  where?: TransferWhere,
) => Promise<T>;

function outcomeOf(result: unknown): { cancelled: boolean; failed: Failure[] } | null {
  if (!result || typeof result !== "object") return null;
  const said = result as Partial<TransferResult>;
  if (typeof said.cancelled !== "boolean" || !Array.isArray(said.failed)) return null;
  return { cancelled: said.cancelled, failed: said.failed };
}

export const newOpId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface RunHooks {
  started(opId: string): void;
  ended(opId: string): void;
}

export async function runOperation<T>(
  label: string,
  work: (opId: string) => Promise<T>,
  where: TransferWhere | undefined,
  hooks: RunHooks,
): Promise<T> {
  const opId = newOpId();
  hooks.started(opId);
  useTransfers.getState().add({
    opId,
    label,
    ...where,
    queuedAt: Date.now(),
    state: "queued",
    doneBytes: 0,
    totalBytes: 0,
  });
  const retry = () => void runOperation(label, work, where, hooks).catch(() => undefined);
  try {
    await waitTurn(opId);
    const result = await work(opId);
    const outcome = outcomeOf(result);
    const failure = outcome?.failed[0];
    useTransfers.getState().update(opId, {
      state: outcome?.cancelled ? "cancelled" : failure ? "failed" : "done",
      endedAt: Date.now(),
      item: undefined,
      error: failure ? failure.error : undefined,
      retry,
    });
    return result;
  } catch (cause) {
    const stopped = useTransfers.getState().byId[opId]?.cancelling === true;
    useTransfers.getState().update(opId, {
      state: stopped ? "cancelled" : "failed",
      endedAt: Date.now(),
      error: stopped ? undefined : messageOf(cause, `${label} didn't finish.`),
      retry,
    });
    throw cause;
  } finally {
    endTurn(opId);
    hooks.ended(opId);
  }
}

export const cancelOperation = (opId: string) => cancelTransfer(opId);

const useUndoStore = create<{ state: UndoState }>(() => ({ state: {} }));

export function refreshUndo() {
  void disk.undoState().then(
    (state) => useUndoStore.setState({ state }),
    () => undefined,
  );
}

export async function stepUndo(which: "undo" | "redo") {
  try {
    useUndoStore.setState({ state: await (which === "undo" ? disk.undo() : disk.redo()) });
  } catch (cause) {
    notify({ message: messageOf(cause, `Couldn't ${which}.`), tone: "error" });
    refreshUndo();
  }
}

export function useUndo(on: boolean): UndoState {
  useEffect(() => {
    if (on) refreshUndo();
  }, [on]);
  return useUndoStore((store) => store.state);
}
