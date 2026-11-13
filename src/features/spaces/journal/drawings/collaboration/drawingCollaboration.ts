import { accountScopeResetEvent } from "@/features/account";
import { createYjsProvider, type CollaborationAccess } from "../../notes/createYjsProvider";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type YProvider from "y-partyserver/provider";
import * as Y from "yjs";
import { drawingsApi } from "../api/api";
import type { DrawingAssetReference, DrawingCollaborationTicket } from "../drawingTypes";

interface DrawingCollaborationSession {
  key: string;
  spaceId: string;
  drawingId: string;
  ticket: DrawingCollaborationTicket;
  doc: Y.Doc;
  elements: Y.Map<OrderedExcalidrawElement>;
  scene: Y.Map<unknown>;
  files: Y.Map<DrawingAssetReference>;
  provider: YProvider;
  role?: DrawingCollaborationTicket["role"];
  /** Whether this person can still reach the drawing; lost once it is deleted or no longer theirs. */
  access: CollaborationAccess;
}

type SessionEntry = {
  refs: number;
  presenceRefs: number;
  idleTimer: number | null;
  session?: DrawingCollaborationSession;
  promise?: Promise<DrawingCollaborationSession>;
};

const sessions = new Map<string, SessionEntry>();
const sessionIdleMs = 5 * 60 * 1000;

export async function acquireDrawingSession(
  spaceId: string,
  drawingId: string,
  options?: { publishPresence?: boolean },
): Promise<DrawingCollaborationSession> {
  const key = `${spaceId}:${drawingId}`;
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
  entry.promise = createSession(spaceId, drawingId, key)
    .then((session) => {
      const current = sessions.get(key);
      if (current !== sessionEntry) {
        destroySession(session);
        throw new Error("Drawing collaboration session was closed.");
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

export function releaseDrawingSession(
  spaceId: string,
  drawingId: string,
  options?: { publishPresence?: boolean },
): void {
  const key = `${spaceId}:${drawingId}`;
  const entry = sessions.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (options?.publishPresence !== false) {
    entry.presenceRefs = Math.max(0, entry.presenceRefs - 1);
    if (entry.presenceRefs === 0) entry.session?.provider.awareness.setLocalState(null);
  }
  if (entry.refs === 0) {
    scheduleIdleClose(key, entry);
  }
}

export function closeDrawingCollaborationSession(spaceId: string, drawingId: string): void {
  const key = `${spaceId}:${drawingId}`;
  const entry = sessions.get(key);
  if (!entry) return;
  sessions.delete(key);
  clearIdleTimer(entry);
  if (entry.session) destroySession(entry.session);
}

function closeAllDrawingCollaborationSessions(): void {
  for (const [, entry] of sessions) {
    clearIdleTimer(entry);
    if (entry.session) destroySession(entry.session);
  }
  sessions.clear();
}

async function createSession(
  spaceId: string,
  drawingId: string,
  key: string,
): Promise<DrawingCollaborationSession> {
  const firstTicket = await drawingsApi.collaborationTicket(spaceId, drawingId);
  const doc = new Y.Doc();
  const { provider, access } = createYjsProvider(firstTicket, doc, "drawing-room", () =>
    drawingsApi.collaborationTicket(spaceId, drawingId),
  );
  // Nobody shows as here until a view publishes who they are: a preview tile never does, so it
  // must not appear to others as a nameless collaborator.
  provider.awareness.setLocalState(null);
  return {
    key,
    spaceId,
    drawingId,
    ticket: firstTicket,
    // What the room lets this person do (a closing account only views), over the drawing's own.
    role: firstTicket.role,
    doc,
    elements: doc.getMap<OrderedExcalidrawElement>("drawing:elements"),
    scene: doc.getMap("drawing:scene"),
    files: doc.getMap<DrawingAssetReference>("drawing:files"),
    provider,
    access,
  };
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

function destroySession(session: DrawingCollaborationSession): void {
  session.provider.destroy();
  session.doc.destroy();
}

/** A deleted drawing's open copy stops syncing at once, without waiting for the room to close it. */
function closeDeletedDrawing(event: Event): void {
  const detail = (event as CustomEvent<{ type?: string; space_id?: string; payload?: unknown }>)
    .detail;
  if (detail?.type !== "drawing.deleted" || !detail.space_id) return;
  const drawingId = (detail.payload as { drawing_id?: unknown } | undefined)?.drawing_id;
  if (typeof drawingId !== "string") return;
  sessions.get(`${detail.space_id}:${drawingId}`)?.session?.access.lose("deleted");
}

if (typeof window !== "undefined") {
  window.addEventListener(accountScopeResetEvent, closeAllDrawingCollaborationSessions);
  window.addEventListener("misty:space-drawing-event", closeDeletedDrawing);
}
