// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { create } from "zustand";
import { disk } from "@/features/files";

export interface TransferWhere {
  from?: string;
  to?: string;
  items?: number;
}

export interface Transfer extends TransferWhere {
  opId: string;
  label: string;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  doneBytes: number;
  totalBytes: number;
  item?: string;
  error?: string;
  cancelling?: boolean;
  retry?: () => void;
}

interface TransfersStore {
  list: Transfer[];
  paused: boolean;
  add(transfer: Transfer): void;
  update(opId: string, change: Partial<Transfer>): void;
  clearFinished(): void;
  setPaused(paused: boolean): void;
}

const KEPT = 200;

export const useTransfers = create<TransfersStore>((set) => ({
  list: [],
  paused: false,
  add: (transfer) => set((now) => ({ list: [transfer, ...now.list].slice(0, KEPT) })),
  update: (opId, change) =>
    set((now) => ({
      list: now.list.map((each) => (each.opId === opId ? { ...each, ...change } : each)),
    })),
  clearFinished: () =>
    set((now) => ({
      list: now.list.filter((each) => each.state === "running" || each.state === "queued"),
    })),
  setPaused: (paused) => {
    set({ paused });
    if (!paused) pump();
  },
}));

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

export function waitTurn(opId: string): Promise<void> {
  return new Promise((start, stop) => {
    waiting.push({ opId, start, stop });
    pump();
  });
}

export function endTurn(opId: string) {
  if (running === opId) running = null;
  pump();
}

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
