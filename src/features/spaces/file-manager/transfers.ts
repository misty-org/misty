// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { create } from "zustand";
import { disk, fileEvents, onFilesEvent, type Progress } from "@/features/files";

export interface TransferWhere {
  from?: string;
  to?: string;
  items?: number;
  stoppable?: boolean;
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
  byId: Record<string, Transfer>;
  order: string[];
  paused: boolean;
  add(transfer: Transfer): void;
  update(opId: string, change: Partial<Transfer>): void;
  clearFinished(): void;
  setPaused(paused: boolean): void;
}

const KEPT = 200;

let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  onFilesEvent<Progress>(fileEvents.progress, (next) =>
    useTransfers.getState().update(next.opId, {
      doneBytes: next.doneBytes,
      totalBytes: next.totalBytes,
      item: next.item,
    }),
  );
}

export const canStop = (transfer: Transfer) =>
  transfer.state === "queued" || (transfer.state === "running" && transfer.stoppable !== false);

const unfinished = (transfer: Transfer | undefined) =>
  transfer?.state === "running" || transfer?.state === "queued";

export const useTransfers = create<TransfersStore>((set) => ({
  byId: {},
  order: [],
  paused: false,
  add: (transfer) => {
    listen();
    set((now) => {
      const order = [transfer.opId, ...now.order.filter((id) => id !== transfer.opId)];
      const kept = order.slice(0, KEPT);
      const byId: Record<string, Transfer> = { [transfer.opId]: transfer };
      for (const id of kept) if (id !== transfer.opId && now.byId[id]) byId[id] = now.byId[id];
      return { order: kept, byId };
    });
  },
  update: (opId, change) =>
    set((now) => {
      const was = now.byId[opId];
      if (!was) return now;
      return { byId: { ...now.byId, [opId]: { ...was, ...change } } };
    }),
  clearFinished: () =>
    set((now) => {
      const order = now.order.filter((id) => unfinished(now.byId[id]));
      return { order, byId: Object.fromEntries(order.map((id) => [id, now.byId[id]])) };
    }),
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
