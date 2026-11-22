// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { create } from "zustand";
import { disk } from "@/features/files";

/** Where a transfer reads from and writes to, and how many items it carries. */
export interface TransferWhere {
  from?: string;
  to?: string;
  items?: number;
}

/** One long operation Files ran (a copy, a move, a compress), as Kura's Transfers lists it. */
export interface Transfer extends TransferWhere {
  opId: string;
  label: string;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  doneBytes: number;
  totalBytes: number;
  /** The item it is on now. */
  item?: string;
  error?: string;
  /** Cancel was asked for: when it ends, it ends as cancelled rather than failed. */
  cancelling?: boolean;
  /** Runs the same work again, for one that failed or was cancelled. */
  retry?: () => void;
}

interface TransfersStore {
  list: Transfer[];
  /** Kura's Pause queue: what is running finishes, what waits stays waiting. */
  paused: boolean;
  add(transfer: Transfer): void;
  update(opId: string, change: Partial<Transfer>): void;
  clearFinished(): void;
  setPaused(paused: boolean): void;
}

/** How many transfers are kept; they last until Misty quits. */
const KEPT = 200;

/**
 * Every transfer started in this window, newest first, run one at a time as Kura's queue runs them.
 * It lives as long as the window: the history is this session's, and the system's own Trash and Undo
 * keep the rest.
 */
export const useTransfers = create<TransfersStore>((set) => ({
  list: [],
  paused: false,
  add: (transfer) => set((now) => ({ list: [transfer, ...now.list].slice(0, KEPT) })),
  update: (opId, change) =>
    set((now) => ({ list: now.list.map((each) => (each.opId === opId ? { ...each, ...change } : each)) })),
  clearFinished: () => set((now) => ({ list: now.list.filter((each) => each.state === "running" || each.state === "queued") })),
  setPaused: (paused) => {
    set({ paused });
    if (!paused) pump();
  },
}));

/** The queue: one transfer runs at a time, the rest wait their turn in the order they came. */
let running: string | null = null;
const waiting: { opId: string; start(): void; stop(reason: Error): void }[] = [];

function pump() {
  if (running || useTransfers.getState().paused) return;
  const next = waiting.shift();
  if (!next) return;
  running = next.opId;
  useTransfers.getState().update(next.opId, { state: "running", startedAt: Date.now() });
  next.start();
}

/** Waits for a transfer's turn; it rejects if the transfer is cancelled while it waits. */
export function waitTurn(opId: string): Promise<void> {
  return new Promise((start, stop) => {
    waiting.push({ opId, start, stop });
    pump();
  });
}

/** A transfer ended: the next one may start. */
export function endTurn(opId: string) {
  if (running === opId) running = null;
  pump();
}

/** Stops a transfer: one that waits leaves the queue, one that runs is stopped by native between items. */
export function cancelTransfer(opId: string) {
  useTransfers.getState().update(opId, { cancelling: true });
  const index = waiting.findIndex((each) => each.opId === opId);
  if (index >= 0) {
    const [left] = waiting.splice(index, 1);
    left.stop(new Error("Cancelled"));
    return;
  }
  void disk.cancel(opId).catch(() => undefined);
}
