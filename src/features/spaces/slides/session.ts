import { accountScopeResetEvent } from "@/features/account";
import type YProvider from "y-partyserver/provider";
import * as Y from "yjs";
import { createYjsProvider, type CollaborationAccess } from "../journal/notes/createYjsProvider";
import { decksApi, type DeckCollaborationTicket, type DeckRole } from "./api";

/**
 * A deck's live room, shared by every view of it (the editor, present mode, an export) and
 * kept open a few minutes after the last one leaves, the way drawings' rooms are.
 */
export interface DeckSession {
  key: string;
  spaceId: string;
  deckId: string;
  /** What the room lets this person do. */
  role?: DeckRole;
  doc: Y.Doc;
  provider: YProvider;
  /** Whether this person can still reach the deck; lost once it is deleted or no longer theirs. */
  access: CollaborationAccess;
}

type SessionEntry = {
  refs: number;
  presenceRefs: number;
  idleTimer: number | null;
  session?: DeckSession;
  promise?: Promise<DeckSession>;
};

const sessions = new Map<string, SessionEntry>();
const sessionIdleMs = 5 * 60 * 1000;
const listeners = new Set<() => void>();

const sessionKey = (spaceId: string, deckId: string) => `${spaceId}:${deckId}`;

export async function acquireDeckSession(
  spaceId: string,
  deckId: string,
  options?: { publishPresence?: boolean },
): Promise<DeckSession> {
  const key = sessionKey(spaceId, deckId);
  let entry = sessions.get(key);
  if (!entry) {
    entry = { refs: 0, presenceRefs: 0, idleTimer: null };
    sessions.set(key, entry);
  }
  entry.refs += 1;
  if (options?.publishPresence !== false) entry.presenceRefs += 1;
  clearIdleTimer(entry);
  if (entry.session) return entry.session;
  if (entry.promise) return entry.promise;

  const sessionEntry = entry;
  entry.promise = createSession(spaceId, deckId, key)
    .then((session) => {
      const current = sessions.get(key);
      if (current !== sessionEntry) {
        destroySession(session);
        throw new Error("The deck's live session was closed.");
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

export function releaseDeckSession(
  spaceId: string,
  deckId: string,
  options?: { publishPresence?: boolean },
): void {
  const key = sessionKey(spaceId, deckId);
  const entry = sessions.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (options?.publishPresence !== false) {
    entry.presenceRefs = Math.max(0, entry.presenceRefs - 1);
    if (entry.presenceRefs === 0) entry.session?.provider.awareness.setLocalState(null);
  }
  if (entry.refs === 0) scheduleIdleClose(key, entry);
}

/** Closes a deck's room at once, as after it is deleted here. */
export function closeDeckCollaborationSession(spaceId: string, deckId: string): void {
  const key = sessionKey(spaceId, deckId);
  const entry = sessions.get(key);
  if (!entry) return;
  sessions.delete(key);
  clearIdleTimer(entry);
  if (entry.session) destroySession(entry.session);
  notify();
}

/** The open session, if any, for a view that only reads it. */
export function peekDeckSession(spaceId: string, deckId: string): DeckSession | null {
  return sessions.get(sessionKey(spaceId, deckId))?.session ?? null;
}

export function subscribeToDeckSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Resolves once the room has sent its content (or right away when it already has). */
export function whenDeckSynced(session: DeckSession, timeoutMs = 15_000): Promise<void> {
  if (session.provider.synced) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      session.provider.off("synced", onSynced);
      reject(new Error("The deck's live room didn't answer. Check your connection."));
    }, timeoutMs);
    const onSynced = (ready: boolean) => {
      if (!ready) return;
      window.clearTimeout(timer);
      session.provider.off("synced", onSynced);
      resolve();
    };
    session.provider.on("synced", onSynced);
  });
}

async function createSession(spaceId: string, deckId: string, key: string): Promise<DeckSession> {
  const firstTicket: DeckCollaborationTicket = await decksApi.collaborationTicket(spaceId, deckId);
  const doc = new Y.Doc();
  const { provider, access } = createYjsProvider(firstTicket, doc, "deck-room", () =>
    decksApi.collaborationTicket(spaceId, deckId),
  );
  // Nobody shows as here until a view publishes who they are.
  provider.awareness.setLocalState(null);
  return { key, spaceId, deckId, role: firstTicket.role, doc, provider, access };
}

function scheduleIdleClose(key: string, entry: SessionEntry): void {
  if (entry.idleTimer != null || !entry.session) return;
  entry.idleTimer = window.setTimeout(() => {
    const current = sessions.get(key);
    if (!current || current.refs > 0) return;
    sessions.delete(key);
    if (current.session) destroySession(current.session);
    notify();
  }, sessionIdleMs);
}

function clearIdleTimer(entry: SessionEntry): void {
  if (entry.idleTimer == null) return;
  window.clearTimeout(entry.idleTimer);
  entry.idleTimer = null;
}

function destroySession(session: DeckSession): void {
  session.provider.destroy();
  session.doc.destroy();
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function closeAllDeckSessions(): void {
  for (const [, entry] of sessions) {
    clearIdleTimer(entry);
    if (entry.session) destroySession(entry.session);
  }
  sessions.clear();
  notify();
}

/** A deleted deck's open copy stops syncing at once, without waiting for the room to close it. */
function closeDeletedDeck(event: Event): void {
  const detail = (
    event as CustomEvent<{
      type?: string;
      space_id?: string;
      entity_id?: string;
      payload?: unknown;
    }>
  ).detail;
  if (detail?.type !== "deck.deleted" || !detail.space_id) return;
  const payload = detail.payload as { deck_id?: unknown } | undefined;
  const deckId = typeof payload?.deck_id === "string" ? payload.deck_id : detail.entity_id;
  if (typeof deckId !== "string") return;
  sessions.get(sessionKey(detail.space_id, deckId))?.session?.access.lose("deleted");
}

/** The window event the realtime bridge sends each `deck.*` event on. */
export const realtimeDeckEvent = "misty:space-deck-event";

if (typeof window !== "undefined") {
  window.addEventListener(accountScopeResetEvent, closeAllDeckSessions);
  window.addEventListener(realtimeDeckEvent, closeDeletedDeck);
}
