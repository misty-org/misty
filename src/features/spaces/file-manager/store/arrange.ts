import { useEffect, useMemo, useState } from "react";
import { kindOf } from "../format";
import { itemShape, type FileItem } from "../model";
import { arrangeOrder, type ArrangeAsk, type ArrangeRow } from "./arrange_rules";

const WORKER_AT = 5000;

const lowered = new WeakMap<FileItem, string>();

export function lowerName(item: FileItem): string {
  let lower = lowered.get(item);
  if (lower === undefined) {
    lower = item.name.toLocaleLowerCase();
    lowered.set(item, lower);
  }
  return lower;
}

function rowsOf(items: FileItem[], ask: ArrangeAsk): ArrangeRow[] {
  const kinds = ask.sort?.key === "kind";
  return items.map((item) => ({
    name: item.name,
    lower: lowerName(item),
    folder: item.folder,
    size: itemShape(item) === "folder" ? undefined : item.size,
    modified: item.modifiedMs,
    kind: kinds ? kindOf(item) : "",
  }));
}

export function arrange(items: FileItem[], ask: ArrangeAsk): FileItem[] {
  if (!ask.needle && !ask.sort && !ask.finder) return items;
  return arrangeOrder(rowsOf(items, ask), ask).map((index) => items[index]);
}

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<
  number,
  { rows: ArrangeRow[]; ask: ArrangeAsk; done(order: number[]): void }
>();

function arrangeElsewhere(items: FileItem[], ask: ArrangeAsk): Promise<number[]> {
  if (!worker) {
    worker = new Worker(new URL("./arrange_worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ seq: number; order: number[] }>) => {
      const job = waiting.get(event.data.seq);
      waiting.delete(event.data.seq);
      job?.done(event.data.order);
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      const jobs = [...waiting.values()];
      waiting.clear();
      for (const job of jobs) job.done(arrangeOrder(job.rows, job.ask));
    };
  }
  seq += 1;
  const mine = seq;
  const rows = rowsOf(items, ask);
  const sent = worker;
  return new Promise((resolve) => {
    waiting.set(mine, { rows, ask, done: resolve });
    sent.postMessage({ seq: mine, rows, ask });
  });
}

interface Arranged {
  items: FileItem[];
  askKey: string;
  shown: FileItem[];
}

export function useArranged(items: FileItem[], ask: ArrangeAsk): FileItem[] {
  const askKey = JSON.stringify(ask);
  const elsewhere = items.length >= WORKER_AT;
  const here = useMemo(
    () => (elsewhere ? null : arrange(items, JSON.parse(askKey) as ArrangeAsk)),
    [items, askKey, elsewhere],
  );
  const [done, setDone] = useState<Arranged | null>(null);
  useEffect(() => {
    if (!elsewhere) return;
    let live = true;
    void arrangeElsewhere(items, JSON.parse(askKey) as ArrangeAsk).then((order) => {
      if (!live) return;
      setDone({ items, askKey, shown: order.map((index) => items[index]) });
    });
    return () => {
      live = false;
    };
  }, [items, askKey, elsewhere]);
  if (here) return here;
  return done && done.items === items && done.askKey === askKey ? done.shown : items;
}
