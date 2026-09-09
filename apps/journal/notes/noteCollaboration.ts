import { notesApi } from "@/api/notes/api";
import type { NoteCollaborationTicket } from "@/api/notes/api";
import { createYjsProvider } from "@/features/collaboration/createYjsProvider";
import type YProvider from "y-partyserver/provider";
import * as Y from "yjs";
import { readActiveSavedAccountSession } from "@/features/auth";
import type { MobilePendingNoteUpdateRecord } from "@/native/contracts";
import { mobileCacheRead, mobileCacheWrite } from "@/native/mobile-cache";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { hasTauriInternals } from "@/shared/platform/tauri";

export type { NoteCollaborationRole, NoteCollaborationTicket } from "@/api/notes/api";

export interface NoteCollaborationSession {
  key: string;
  spaceId: string;
  noteId: string;
  ticket: NoteCollaborationTicket;
  doc: Y.Doc;
  fragment: Y.XmlFragment;
  title: Y.Text;
  markdown: Y.Text;
  metadata: Y.Map<unknown>;
  provider: YProvider;
  detachMobilePersistence?: () => void;
}

type NoteCollaborationCacheEntry = {
  refs: number;
  idleTimer: number | null;
  session?: NoteCollaborationSession;
  promise?: Promise<NoteCollaborationSession>;
};

export const noteCollaborationIdleMs = 5 * 60 * 1000;
export const closeAllNoteCollaborationSessionsEvent = "misty:note-collaboration-close-all";

const sessions = new Map<string, NoteCollaborationCacheEntry>();

export function createNoteCollaborationTicket(
  spaceId: string,
  noteId: string,
): Promise<NoteCollaborationTicket> {
  return notesApi.collaborationTicket(spaceId, noteId);
}

export function acquireNoteCollaborationSession(
  spaceId: string,
  noteId: string,
): Promise<NoteCollaborationSession> {
  const key = noteCollaborationKey(spaceId, noteId);
  let entry = sessions.get(key);
  if (!entry) {
    entry = { refs: 0, idleTimer: null };
    sessions.set(key, entry);
  }
  entry.refs += 1;
  clearIdleTimer(entry);

  if (entry.session) return Promise.resolve(entry.session);
  if (entry.promise) return entry.promise;

  entry.promise = createSession(spaceId, noteId, key)
    .then((session) => {
      const current = sessions.get(key);
      if (!current) {
        destroySession(session);
        return session;
      }
      current.session = session;
      current.promise = undefined;
      if (current.refs === 0) scheduleIdleClose(key, current);
      return session;
    })
    .catch((error) => {
      const current = sessions.get(key);
      if (current?.promise === entry?.promise) sessions.delete(key);
      throw error;
    });

  return entry.promise;
}

export function releaseNoteCollaborationSession(spaceId: string, noteId: string): void {
  const key = noteCollaborationKey(spaceId, noteId);
  const entry = sessions.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) scheduleIdleClose(key, entry);
}

export function closeAllNoteCollaborationSessions(): void {
  for (const [, entry] of sessions) {
    clearIdleTimer(entry);
    if (entry.session) destroySession(entry.session);
  }
  sessions.clear();
}

async function createSession(
  spaceId: string,
  noteId: string,
  key: string,
): Promise<NoteCollaborationSession> {
  const firstTicket = await createNoteCollaborationTicket(spaceId, noteId);
  const doc = new Y.Doc();
  const accountId = readActiveSavedAccountSession()?.id ?? "";
  const recordKey = `note-update:${spaceId}:${noteId}`;
  if (isNativeMobileBuild && hasTauriInternals() && accountId) {
    const saved = await mobileCacheRead<MobilePendingNoteUpdateRecord>(accountId, recordKey).catch(
      () => null,
    );
    if (saved?.schemaVersion === 1 && saved.accountId === accountId) {
      Y.applyUpdate(doc, decodeBase64(saved.yjsUpdateBase64), "mobile-cache");
    }
  }
  const provider = createYjsProvider(firstTicket, doc, "note-room", () =>
    createNoteCollaborationTicket(spaceId, noteId),
  );

  let detachMobilePersistence: (() => void) | undefined;
  if (isNativeMobileBuild && hasTauriInternals() && accountId) {
    let timer = 0;
    const persist = (_update: Uint8Array, origin: unknown) => {
      if (origin === "mobile-cache") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const record: MobilePendingNoteUpdateRecord = {
          schemaVersion: 1,
          kind: "pending-note-update",
          accountId,
          updatedAt: new Date().toISOString(),
          spaceId,
          noteId,
          yjsUpdateBase64: encodeBase64(Y.encodeStateAsUpdate(doc)),
        };
        void mobileCacheWrite(accountId, recordKey, record);
      }, 250);
    };
    doc.on("update", persist);
    detachMobilePersistence = () => {
      window.clearTimeout(timer);
      doc.off("update", persist);
    };
  }

  return {
    key,
    spaceId,
    noteId,
    ticket: firstTicket,
    doc,
    fragment: doc.getXmlFragment("tiptap"),
    title: doc.getText("misty:title"),
    markdown: doc.getText("misty:markdown"),
    metadata: doc.getMap("misty:document"),
    provider,
    detachMobilePersistence,
  };
}

function scheduleIdleClose(key: string, entry: NoteCollaborationCacheEntry): void {
  if (entry.idleTimer != null || !entry.session) return;
  entry.idleTimer = window.setTimeout(() => {
    const current = sessions.get(key);
    if (!current || current.refs > 0) return;
    sessions.delete(key);
    if (current.session) destroySession(current.session);
  }, noteCollaborationIdleMs);
}

function clearIdleTimer(entry: NoteCollaborationCacheEntry): void {
  if (entry.idleTimer == null) return;
  window.clearTimeout(entry.idleTimer);
  entry.idleTimer = null;
}

function destroySession(session: NoteCollaborationSession): void {
  session.detachMobilePersistence?.();
  session.provider.destroy();
  session.doc.destroy();
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function noteCollaborationKey(spaceId: string, noteId: string): string {
  return `${spaceId}:${noteId}`;
}

if (typeof window !== "undefined") {
  window.addEventListener(
    closeAllNoteCollaborationSessionsEvent,
    closeAllNoteCollaborationSessions,
  );
}
