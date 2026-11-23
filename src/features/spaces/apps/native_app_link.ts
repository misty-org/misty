import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { invoke } from "@/native";
import type { FrameTarget } from "./host_channel";

export const SDK_LANE = "misty:init";
const INLINE_BYTES = 16_384;
const MAX_POST_CHARS = 250_000;
const MARK = "$mistyBytes";
const ANSWER_RETRIES = [1_000, 5_000, 15_000];

type Wire = unknown;
type Entry = [lane: string, frame: Wire];

interface PageEvent {
  mount: string;
  kind: string;
  body?: string;
}

const views = {
  Uint8Array,
  Int8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
  DataView,
} as const;
type ViewKind = keyof typeof views;
type Kind = ViewKind | "ArrayBuffer";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function kindOf(value: unknown): Kind | null {
  const tag = Object.prototype.toString.call(value).slice(8, -1);
  return tag === "ArrayBuffer" || tag in views ? (tag as Kind) : null;
}

function bytesOf(value: unknown, kind: Kind): Uint8Array {
  if (kind === "ArrayBuffer") return new Uint8Array(value as ArrayBuffer);
  const view = value as ArrayBufferView;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 32_768)
    text += String.fromCharCode(...bytes.subarray(at, at + 32_768));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function rebuild(bytes: Uint8Array, kind: unknown): unknown {
  const copy = bytes.slice();
  if (kind === "ArrayBuffer") return copy.buffer;
  if (kind === "Uint8Array") return copy;
  if (kind === "DataView") return new DataView(copy.buffer);
  if (typeof kind !== "string" || !(kind in views))
    throw new Error("The app sent bytes of a kind Misty can't read.");
  const View = views[kind as Exclude<ViewKind, "DataView">] as unknown as {
    new (buffer: ArrayBufferLike, offset: number, length: number): ArrayBufferView;
    BYTES_PER_ELEMENT: number;
  };
  return new View(copy.buffer, 0, copy.byteLength / View.BYTES_PER_ELEMENT);
}

interface Upload {
  reference: string;
  bytes: Uint8Array;
}

function encode(value: unknown, uploads: Upload[], inline: number, depth = 0): Wire {
  if (depth > 64) throw new Error("That message is nested too deeply to reach the app.");
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol")
      throw new Error(`Misty can't send a ${typeof value} to the app.`);
    return value;
  }
  const kind = kindOf(value);
  if (kind) {
    const bytes = bytesOf(value, kind);
    if (bytes.byteLength <= inline) return { [MARK]: toBase64(bytes), k: kind };
    const reference = crypto.randomUUID().replaceAll("-", "");
    uploads.push({ reference, bytes });
    return { [MARK]: "", r: reference, k: kind };
  }
  if (Array.isArray(value)) return value.map((item) => encode(item, uploads, inline, depth + 1));
  const tag = Object.prototype.toString.call(value);
  if (tag !== "[object Object]")
    throw new Error(`Misty can't send a ${tag.slice(8, -1)} to the app.`);
  const result: Record<string, Wire> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = encode(item, uploads, inline, depth + 1);
  }
  return result;
}

async function decode(
  value: Wire,
  load: (reference: string) => Promise<Uint8Array>,
): Promise<unknown> {
  if (!isRecord(value)) return value;
  if (Array.isArray(value)) {
    const list: unknown[] = [];
    for (const item of value) list.push(await decode(item, load));
    return list;
  }
  if (Object.prototype.hasOwnProperty.call(value, MARK)) {
    const bytes =
      typeof value.r === "string" ? await load(value.r) : fromBase64(String(value[MARK]));
    return rebuild(bytes, value.k);
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = await decode(item, load);
  return result;
}

export function mergeAwareness(updates: Uint8Array[]): Uint8Array {
  const latest = new Map<number, { clock: number; state: string }>();
  for (const update of updates) {
    const decoder = decoding.createDecoder(update);
    for (let count = decoding.readVarUint(decoder); count > 0; count -= 1) {
      const client = decoding.readVarUint(decoder);
      const clock = decoding.readVarUint(decoder);
      const state = decoding.readVarString(decoder);
      const seen = latest.get(client);
      if (!seen || clock >= seen.clock) latest.set(client, { clock, state });
    }
  }
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, latest.size);
  for (const [client, { clock, state }] of latest) {
    encoding.writeVarUint(encoder, client);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, state);
  }
  return encoding.toUint8Array(encoder);
}

function awarenessOf(lane: string, frame: unknown): { id: number; update: Uint8Array } | null {
  if (lane !== SDK_LANE || !isRecord(frame) || frame.t !== "evt" || typeof frame.id !== "number")
    return null;
  const data = frame.data;
  if (!isRecord(data) || data.type !== "awareness") return null;
  const kind = kindOf(data.update);
  return kind ? { id: frame.id, update: bytesOf(data.update, kind) } : null;
}

export function coalesceAwareness(batch: Entry[]): Entry[] {
  const groups = new Map<number, number[]>();
  batch.forEach(([lane, frame], index) => {
    const awareness = awarenessOf(lane, frame);
    if (!awareness) return;
    groups.set(awareness.id, [...(groups.get(awareness.id) ?? []), index]);
  });
  const dropped = new Set<number>();
  const merged = new Map<number, Entry>();
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    try {
      const updates = indexes.map((index) => awarenessOf(...batch[index]!)!.update);
      const last = indexes[indexes.length - 1]!;
      const [lane, frame] = batch[last]!;
      const record = frame as Record<string, unknown>;
      merged.set(last, [
        lane,
        { ...record, data: { ...(record.data as object), update: mergeAwareness(updates) } },
      ]);
      indexes.slice(0, -1).forEach((index) => dropped.add(index));
    } catch {
      continue;
    }
  }
  return batch.flatMap((entry, index) => (dropped.has(index) ? [] : [merged.get(index) ?? entry]));
}

const failure = (error: unknown, prefix: string) =>
  `${prefix}: ${error instanceof Error ? error.message : String(error)}`;

export function refsIn(value: Wire, found: string[] = [], depth = 0): string[] {
  if (!isRecord(value) || depth > 64) return found;
  if (Array.isArray(value)) {
    for (const item of value) refsIn(item, found, depth + 1);
    return found;
  }
  if (Object.prototype.hasOwnProperty.call(value, MARK)) {
    if (typeof value.r === "string") found.push(value.r);
    return found;
  }
  for (const item of Object.values(value)) refsIn(item, found, depth + 1);
  return found;
}

export interface AppPageLink {
  readonly mount: string;
  readonly frame: FrameTarget;
  onReady(listener: () => void): () => void;
  onLeft(listener: () => void): () => void;
  onPageEvent(listener: (kind: string, body: unknown) => void): () => void;
  takeBytes(reference: string): Promise<Uint8Array>;
  dispose(): void;
}

type Outgoing = { start: { lane: string; message: unknown } } | { frame: Entry };
type Queued = Outgoing & { lap: number };

export function createAppPageLink(mount: string, options: { world?: boolean } = {}): AppPageLink {
  const inline = options.world ? Number.POSITIVE_INFINITY : INLINE_BYTES;
  const postLimit = options.world ? Number.POSITIVE_INFINITY : MAX_POST_CHARS;
  const ports = new Map<string, MessagePort>();
  const readyListeners = new Set<() => void>();
  const leftListeners = new Set<() => void>();
  const pageListeners = new Set<(kind: string, body: unknown) => void>();
  const ending = new Set<string>();
  const retried = new Map<string, number>();
  let disposed = false;
  let lap = 0;
  let doc: string | undefined;
  let outgoing: Queued[] = [];
  let scheduled = false;
  let sending = Promise.resolve();
  let receiving = Promise.resolve();

  const current = (at: number) => !disposed && at === lap;
  const post = (body: unknown) =>
    invoke<void>("space_app_page_post", { mount, body: JSON.stringify(body), doc });
  const load = async (reference: string) =>
    new Uint8Array(
      await tauriInvoke<ArrayBuffer>("space_app_page_take_bytes", { mount, reference }),
    );
  const free = (references: string[]) => {
    for (const reference of references)
      void tauriInvoke("space_app_page_take_bytes", { mount, reference, discard: true }).catch(
        () => undefined,
      );
  };
  const upload = (item: Upload) =>
    tauriInvoke<void>("space_app_page_put_bytes", item.bytes, {
      headers: { "x-misty-mount": mount, "x-misty-ref": item.reference },
    });

  const toHost = (lane: string, frame: unknown) => {
    if (!disposed) ports.get(lane)?.postMessage(frame);
  };
  const queue = (entry: Outgoing, at = lap) => {
    if (!current(at)) return;
    outgoing.push({ ...entry, lap: at });
    schedule();
  };

  const answerLater = (entry: Entry, at: number) => {
    const [lane, frame] = entry;
    if (!isRecord(frame)) return;
    const key = `${lane}:${String(frame.t)}:${String(frame.id)}`;
    const tries = retried.get(key) ?? 0;
    const delay = ANSWER_RETRIES[tries];
    if (delay === undefined) {
      retried.delete(key);
      return console.warn("Misty couldn't tell the app that its message didn't arrive.");
    }
    retried.set(key, tries + 1);
    window.setTimeout(() => queue({ frame: entry }, at), delay);
  };

  const undeliverable = ([lane, frame]: Entry, error: unknown, reachable: boolean, at: number) => {
    if (!current(at) || !isRecord(frame) || typeof frame.id !== "number") return;
    const message = failure(error, "Misty's message didn't reach the app");
    if (lane === SDK_LANE && frame.t === "res") {
      const answer: Entry = [
        lane,
        { t: "res", id: frame.id, ok: false, error: { code: "internal", message } },
      ];
      return reachable ? queue({ frame: answer }, at) : answerLater(answer, at);
    }
    if (lane === SDK_LANE && frame.t === "end" && !reachable) return answerLater([lane, frame], at);
    if (lane === SDK_LANE && frame.t === "evt") {
      const key = `${lane}:${frame.id}`;
      if (ending.has(key)) return;
      ending.add(key);
      const end: Entry = [lane, { t: "end", id: frame.id, error: { code: "internal", message } }];
      if (reachable) queue({ frame: end }, at);
      else answerLater(end, at);
      return toHost(lane, { t: "unsub", id: frame.id });
    }
    if (frame.t === "cmd") toHost(lane, { t: "cmd-res", id: frame.id, ok: false, error: message });
  };

  const sendFrames = async (entries: Entry[], at: number) => {
    const encoded: { entry: Entry; wire: Entry; uploads: Upload[] }[] = [];
    for (const entry of coalesceAwareness(entries)) {
      const uploads: Upload[] = [];
      try {
        encoded.push({ entry, wire: [entry[0], encode(entry[1], uploads, inline)], uploads });
      } catch (error) {
        undeliverable(entry, error, true, at);
      }
    }
    if (!encoded.length) return;
    const settled = await Promise.all(
      encoded.map((item) => Promise.allSettled(item.uploads.map(upload))),
    );
    const ready: { entry: Entry; wire: Entry; refs: string[] }[] = [];
    encoded.forEach((item, index) => {
      const results = settled[index]!;
      const refs = item.uploads.map((upload) => upload.reference);
      const failed = results.find((result) => result.status === "rejected");
      if (!failed) {
        ready.push({ entry: item.entry, wire: item.wire, refs });
        return;
      }
      free(refs.filter((_, position) => results[position]!.status === "fulfilled"));
      undeliverable(item.entry, (failed as PromiseRejectedResult).reason, true, at);
    });
    if (!current(at)) return free(ready.flatMap((item) => item.refs));
    let chunk: typeof ready = [];
    let size = 0;
    const flushChunk = async () => {
      if (!chunk.length) return;
      const sent = chunk;
      chunk = [];
      size = 0;
      if (!current(at)) return free(sent.flatMap((item) => item.refs));
      try {
        await post({ frames: sent.map(({ wire }) => wire) });
      } catch (error) {
        free(sent.flatMap((item) => item.refs));
        sent.forEach(({ entry }) => undeliverable(entry, error, false, at));
      }
    };
    for (const item of ready) {
      const length = JSON.stringify(item.wire).length;
      if (size + length > postLimit) await flushChunk();
      chunk.push(item);
      size += length;
    }
    await flushChunk();
  };

  const flush = async (batch: Queued[]) => {
    let frames: Entry[] = [];
    let framesLap = lap;
    for (const item of batch) {
      if (!current(item.lap)) continue;
      if ("frame" in item) {
        frames.push(item.frame);
        framesLap = item.lap;
        continue;
      }
      await sendFrames(frames, framesLap);
      frames = [];
      if (!current(item.lap)) continue;
      await post({ start: item.start }).catch((error: unknown) =>
        console.warn(failure(error, "The app didn't start")),
      );
    }
    await sendFrames(frames, framesLap);
  };

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      scheduled = false;
      const batch = outgoing;
      outgoing = [];
      sending = sending.then(() => flush(batch)).catch(() => undefined);
    };
    window.requestAnimationFrame(run);
    window.setTimeout(run, 16);
  }

  const unreadable = ([lane, frame]: Entry, error: unknown, at: number) => {
    if (!current(at) || !isRecord(frame) || typeof frame.id !== "number") return;
    const message = failure(error, "Misty couldn't take this from the app");
    if (lane === SDK_LANE && frame.t === "req")
      return queue(
        {
          frame: [lane, { t: "res", id: frame.id, ok: false, error: { code: "internal", message } }],
        },
        at,
      );
    if (lane === SDK_LANE && frame.t === "sub")
      return queue(
        { frame: [lane, { t: "end", id: frame.id, error: { code: "internal", message } }] },
        at,
      );
    if (frame.t === "cmd-res")
      toHost(lane, { t: "cmd-res", id: frame.id, ok: false, error: message });
  };

  const receive = async (body: string, at: number) => {
    let entries: unknown;
    try {
      entries = JSON.parse(body);
    } catch {
      return;
    }
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
      const pair = entry as Entry;
      if (!current(at) || !ports.has(pair[0])) {
        free(refsIn(pair[1]));
        continue;
      }
      try {
        const decoded = await decode(pair[1], load);
        if (current(at)) toHost(pair[0], decoded);
      } catch (error) {
        free(refsIn(pair[1]));
        unreadable(pair, error, at);
      }
    }
  };

  const closeLanes = () => {
    lap += 1;
    for (const port of ports.values()) {
      port.onmessage = null;
      port.close();
    }
    ports.clear();
    ending.clear();
    retried.clear();
    outgoing = [];
  };

  const stopListening = listen<PageEvent>("misty://app-page", ({ payload }) => {
    if (disposed || payload.mount !== mount) return;
    if (payload.kind === "opened") {
      closeLanes();
      doc = undefined;
      leftListeners.forEach((listener) => listener());
      return;
    }
    if (payload.kind === "ready") {
      closeLanes();
      doc = payload.body || undefined;
      readyListeners.forEach((listener) => listener());
      return;
    }
    if (payload.kind === "lost") return console.warn("A message from the app didn't reach Misty.");
    if (payload.kind === "frames") {
      const body = payload.body;
      const at = lap;
      if (body) receiving = receiving.then(() => receive(body, at)).catch(() => undefined);
      return;
    }
    let body: unknown = null;
    try {
      body = payload.body ? JSON.parse(payload.body) : null;
    } catch {
      return;
    }
    pageListeners.forEach((listener) => listener(payload.kind, body));
  });

  const frame: FrameTarget = {
    postMessage(message, _targetOrigin, transfer) {
      const port = transfer[0];
      if (
        disposed ||
        !isRecord(message) ||
        typeof message.type !== "string" ||
        !(port instanceof MessagePort)
      )
        return;
      const lane = message.type;
      const at = lap;
      const old = ports.get(lane);
      if (old) {
        old.onmessage = null;
        old.close();
      }
      ports.set(lane, port);
      port.onmessage = (event: MessageEvent) => queue({ frame: [lane, event.data] }, at);
      const { type: _type, ...rest } = message;
      queue({ start: { lane, message: rest } }, at);
    },
  };

  return {
    mount,
    frame,
    onReady(listener) {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
    onLeft(listener) {
      leftListeners.add(listener);
      return () => leftListeners.delete(listener);
    },
    onPageEvent(listener) {
      pageListeners.add(listener);
      return () => pageListeners.delete(listener);
    },
    takeBytes: load,
    dispose() {
      if (disposed) return;
      disposed = true;
      closeLanes();
      readyListeners.clear();
      leftListeners.clear();
      pageListeners.clear();
      void stopListening.then((stop) => stop()).catch(() => undefined);
    },
  };
}
