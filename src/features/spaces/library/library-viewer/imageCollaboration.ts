import { accountScopeResetEvent } from "@/features/account";
import type YProvider from "y-partyserver/provider";
import * as Y from "yjs";
import type { LibraryImageCollaborationTicket } from "../../api/library-edits";
import { spacesApi } from "../../api/api";
import { createYjsProvider, type CollaborationAccess } from "../../journal/notes/createYjsProvider";

/**
 * A library image's live edit: one shared document per image, open while anyone here edits it,
 * that everyone editing it (people and their agents) changes together. The image itself stays in
 * the library; the room holds only what is being done to it until someone saves.
 */
export interface ImageCollaborationSession {
  key: string;
  spaceId: string;
  itemId: string;
  doc: Y.Doc;
  provider: YProvider;
  role: LibraryImageCollaborationTicket["role"];
  access: CollaborationAccess;
}

type SessionEntry = {
  refs: number;
  idleTimer: number | null;
  session?: ImageCollaborationSession;
  promise?: Promise<ImageCollaborationSession>;
};

const sessions = new Map<string, SessionEntry>();
/** How long a room stays connected after its editor closes, so reopening it is instant. */
const sessionIdleMs = 2 * 60 * 1000;

export async function acquireImageSession(
  spaceId: string,
  itemId: string,
): Promise<ImageCollaborationSession> {
  const key = `${spaceId}:${itemId}`;
  let entry = sessions.get(key);
  if (!entry) {
    entry = { refs: 0, idleTimer: null };
    sessions.set(key, entry);
  }
  entry.refs += 1;
  clearIdleTimer(entry);
  if (entry.session) return entry.session;
  if (entry.promise) return entry.promise;

  const sessionEntry = entry;
  entry.promise = createSession(spaceId, itemId, key)
    .then((session) => {
      const current = sessions.get(key);
      if (current !== sessionEntry) {
        destroySession(session);
        throw new Error("The image's live edit was closed.");
      }
      current.session = session;
      current.promise = undefined;
      if (current.refs === 0) scheduleIdleClose(key, current);
      return session;
    })
    .catch((error) => {
      if (sessions.get(key) === sessionEntry) sessions.delete(key);
      throw error;
    });
  return entry.promise;
}

export function releaseImageSession(spaceId: string, itemId: string): void {
  const key = `${spaceId}:${itemId}`;
  const entry = sessions.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) {
    // Whoever leaves stops showing as here at once, though the connection lingers a while.
    entry.session?.provider.awareness.setLocalState(null);
    scheduleIdleClose(key, entry);
  }
}

async function createSession(
  spaceId: string,
  itemId: string,
  key: string,
): Promise<ImageCollaborationSession> {
  const firstTicket = await spacesApi.imageCollaborationTicket(spaceId, itemId);
  const doc = new Y.Doc();
  const { provider, access } = createYjsProvider(firstTicket, doc, "image-room", () =>
    spacesApi.imageCollaborationTicket(spaceId, itemId),
  );
  // Nobody shows as here until the editor says who they are.
  provider.awareness.setLocalState(null);
  return { key, spaceId, itemId, doc, provider, role: firstTicket.role, access };
}

function scheduleIdleClose(key: string, entry: SessionEntry): void {
  if (entry.idleTimer != null || !entry.session) return;
  entry.idleTimer = window.setTimeout(() => {
    const current = sessions.get(key);
    if (!current || current.refs > 0) return;
    sessions.delete(key);
    if (current.session) destroySession(current.session);
  }, sessionIdleMs);
}

function clearIdleTimer(entry: SessionEntry): void {
  if (entry.idleTimer == null) return;
  window.clearTimeout(entry.idleTimer);
  entry.idleTimer = null;
}

function destroySession(session: ImageCollaborationSession): void {
  session.provider.destroy();
  session.doc.destroy();
}

function closeAllImageSessions(): void {
  for (const [, entry] of sessions) {
    clearIdleTimer(entry);
    if (entry.session) destroySession(entry.session);
  }
  sessions.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener(accountScopeResetEvent, closeAllImageSessions);
}
