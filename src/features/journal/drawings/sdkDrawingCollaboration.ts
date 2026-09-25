import type { MistyAppSDK } from "@misty/sdk";
import { connectMistyYjs } from "@misty/sdk/yjs";
import * as Y from "yjs";
import type { DrawingSession } from "./drawingRuntime";
import type { DrawingAssetReference } from "./types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type Entry = {
  refs: number;
  presenceRefs: number;
  session?: DrawingSession;
  promise: Promise<DrawingSession>;
  destroy: () => void;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setTimeout>;
};

/** Canvas and preview share one SDK connection; only visible canvases publish presence. */
export function createSdkDrawingCollaboration(
  misty: MistyAppSDK,
  spaceId: string,
  signal: AbortSignal,
) {
  const entries = new Map<string, Entry>();
  let closed = signal.aborted;
  const check = (requestedSpace: string) => {
    if (closed || signal.aborted) throw new Error("This Journal view is closed.");
    if (!spaceId || requestedSpace !== spaceId)
      throw new Error("This drawing belongs to another Space.");
  };
  const dispose = (drawingId: string, entry: Entry) => {
    if (entries.get(drawingId) === entry) entries.delete(drawingId);
    clearTimeout(entry.timer);
    entry.destroy();
    for (const listener of entry.listeners) listener();
    entry.listeners.clear();
  };
  const clear = () => {
    for (const [id, entry] of entries) dispose(id, entry);
  };
  const close = () => {
    closed = true;
    clear();
    signal.removeEventListener("abort", close);
  };
  signal.addEventListener("abort", close, { once: true });
  return {
    clear,
    close,
    closeDocument(requestedSpace: string, drawingId: string) {
      if (requestedSpace !== spaceId) return;
      const entry = entries.get(drawingId);
      if (entry) dispose(drawingId, entry);
    },
    acquire(
      requestedSpace: string,
      drawingId: string,
      options?: { publishPresence?: boolean },
    ): Promise<DrawingSession> {
      check(requestedSpace);
      const current = entries.get(drawingId);
      if (current) {
        current.refs++;
        if (options?.publishPresence !== false) current.presenceRefs++;
        clearTimeout(current.timer);
        current.timer = undefined;
        return current.session ? Promise.resolve(current.session) : current.promise;
      }
      if (entries.size >= 16)
        return Promise.reject(new Error("Close a Journal document before opening another."));
      const doc = new Y.Doc(),
        lifetime = new AbortController();
      const entry: Entry = {
        refs: 1,
        presenceRefs: options?.publishPresence !== false ? 1 : 0,
        promise: undefined as never,
        listeners: new Set(),
        destroy: () => {
          lifetime.abort();
          doc.destroy();
        },
      };
      entries.set(drawingId, entry);
      entry.promise = connectMistyYjs(misty.collaboration, {
        resource: "drawing",
        resourceId: drawingId,
        doc,
        signal: lifetime.signal,
        onRole: (role) => {
          if (!entry.session || entries.get(drawingId) !== entry || entry.session.role === role)
            return;
          entry.session = { ...entry.session, role };
          for (const listener of entry.listeners) listener();
        },
      })
        .then((connection) => {
          if (closed || entries.get(drawingId) !== entry) {
            connection.destroy();
            throw new Error("The Journal document closed while connecting.");
          }
          entry.destroy = () => {
            connection.destroy();
            lifetime.abort();
            doc.destroy();
          };
          entry.session = {
            key: crypto.randomUUID(),
            role: connection.role,
            doc,
            elements: doc.getMap<OrderedExcalidrawElement>("drawing:elements"),
            scene: doc.getMap("drawing:scene"),
            files: doc.getMap<DrawingAssetReference>("drawing:files"),
            provider: connection.provider,
          };
          return entry.session;
        })
        .catch((error) => {
          dispose(drawingId, entry);
          throw error;
        });
      return entry.promise;
    },
    release(requestedSpace: string, drawingId: string, options?: { publishPresence?: boolean }) {
      if (requestedSpace !== spaceId) return;
      const entry = entries.get(drawingId);
      if (!entry) return;
      if (options?.publishPresence !== false) {
        entry.presenceRefs = Math.max(0, entry.presenceRefs - 1);
        if (!entry.presenceRefs) entry.session?.provider.awareness.setLocalState(null);
      }
      entry.refs = Math.max(0, entry.refs - 1);
      if (!entry.refs && !entry.timer)
        entry.timer = setTimeout(() => dispose(drawingId, entry), 30_000);
    },
    subscribe(requestedSpace: string, drawingId: string, listener: () => void) {
      check(requestedSpace);
      const entry = entries.get(drawingId);
      entry?.listeners.add(listener);
      return () => entry?.listeners.delete(listener);
    },
    read(drawingId: string) {
      return entries.get(drawingId)?.session ?? null;
    },
  };
}
export type SdkDrawingCollaboration = ReturnType<typeof createSdkDrawingCollaboration>;
