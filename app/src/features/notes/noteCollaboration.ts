import { notesApi } from "@/api/notes/api";
import type { NoteCollaborationTicket } from "@/api/notes/api";
import { createYjsProvider } from "@/features/collaboration/createYjsProvider";
import type YProvider from "y-partyserver/provider";
import * as Y from "yjs";

export type { NoteCollaborationRole, NoteCollaborationTicket } from "@/api/notes/api";

export interface NoteCollaborationSession {
  key: string;
  spaceId: string;
  noteId: string;
  ticket: NoteCollaborationTicket;
  doc: Y.Doc;
  fragment: Y.XmlFragment;
  provider: YProvider;
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
  const provider = createYjsProvider(firstTicket, doc, "note-room", () =>
    createNoteCollaborationTicket(spaceId, noteId),
  );

  return {
    key,
    spaceId,
    noteId,
    ticket: firstTicket,
    doc,
    fragment: doc.getXmlFragment("doc"),
    provider,
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
  session.provider.destroy();
  session.doc.destroy();
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
