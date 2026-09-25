import type { MistyAppSDK } from "@misty/sdk";
import { connectMistyYjs } from "@misty/sdk/yjs";
import * as Y from "yjs";
import { useEffect, useState } from "react";
import {
  journalDocumentStatusMessage,
  parseJournalDocumentStatus,
} from "@/features/journal/collaborationStatus";
import type { NoteEditorSession } from "./components/NoteBlockEditorView";

type Entry = {
  refs: number;
  session?: NoteEditorSession;
  promise: Promise<NoteEditorSession>;
  destroy: () => void;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setTimeout>;
};

/** A note's title and body share one SDK connection inside one mounted Journal app. */
export function createSdkNoteCollaboration(
  misty: MistyAppSDK,
  spaceId: string,
  signal: AbortSignal,
) {
  const entries = new Map<string, Entry>();
  let closed = signal.aborted;
  const check = (requestedSpace: string) => {
    if (closed || signal.aborted) throw new Error("This Journal view is closed.");
    if (!spaceId || requestedSpace !== spaceId)
      throw new Error("This note belongs to another Space.");
  };
  const dispose = (noteId: string, entry: Entry) => {
    if (entries.get(noteId) === entry) entries.delete(noteId);
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
    acquire(requestedSpace: string, noteId: string): Promise<NoteEditorSession> {
      check(requestedSpace);
      const current = entries.get(noteId);
      if (current) {
        current.refs++;
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
        promise: undefined as never,
        listeners: new Set(),
        destroy: () => {
          lifetime.abort();
          doc.destroy();
        },
      };
      entries.set(noteId, entry);
      entry.promise = connectMistyYjs(misty.collaboration, {
        resource: "note",
        resourceId: noteId,
        doc,
        signal: lifetime.signal,
        onRole: (role) => {
          if (!entry.session || entries.get(noteId) !== entry || entry.session.role === role)
            return;
          entry.session = { ...entry.session, role };
          for (const listener of entry.listeners) listener();
        },
      })
        .then((connection) => {
          if (closed || entries.get(noteId) !== entry) {
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
            fragment: doc.getXmlFragment("tiptap"),
            title: doc.getText("misty:title"),
            markdown: doc.getText("misty:markdown"),
            metadata: doc.getMap("misty:document"),
            provider: connection.provider,
          };
          return entry.session;
        })
        .catch((error) => {
          dispose(noteId, entry);
          throw error;
        });
      return entry.promise;
    },
    release(requestedSpace: string, noteId: string) {
      if (requestedSpace !== spaceId) return;
      const entry = entries.get(noteId);
      if (!entry) return;
      entry.refs = Math.max(0, entry.refs - 1);
      if (!entry.refs && !entry.timer)
        entry.timer = setTimeout(() => dispose(noteId, entry), 30_000);
    },
    subscribe(requestedSpace: string, noteId: string, listener: () => void) {
      check(requestedSpace);
      const entry = entries.get(noteId);
      entry?.listeners.add(listener);
      return () => entry?.listeners.delete(listener);
    },
    read(noteId: string) {
      return entries.get(noteId)?.session ?? null;
    },
  };
}
export type SdkNoteCollaboration = ReturnType<typeof createSdkNoteCollaboration>;

export function useSdkNoteCollaborationRoom(
  owner: SdkNoteCollaboration,
  spaceId: string,
  noteId: string,
) {
  const [session, setSession] = useState<NoteEditorSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let detach: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    setSession(null);
    setError(null);
    setNotice(null);
    let pending: Promise<NoteEditorSession>;
    try {
      pending = owner.acquire(spaceId, noteId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not connect to this note.");
      return;
    }
    void pending
      .then((next) => {
        if (!active) return;
        const receive = (message: string) => {
          const status = parseJournalDocumentStatus(message);
          if (status) setNotice(journalDocumentStatusMessage(status));
        };
        next.provider.on("custom-message", receive);
        detach = () => next.provider.off("custom-message", receive);
        unsubscribe = owner.subscribe(spaceId, noteId, () => setSession(owner.read(noteId)));
        setSession(owner.read(noteId) ?? next);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "Could not connect to this note.");
      });
    return () => {
      active = false;
      detach?.();
      unsubscribe?.();
      owner.release(spaceId, noteId);
    };
  }, [owner, spaceId, noteId]);
  return { session, error, notice };
}
