import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import YProvider from "y-partyserver/provider";
import * as Y from "yjs";
import { accountScopeResetEvent } from "@/stores/account/accountEvents";
import { drawingsApi } from "../api/drawingsApi";
import type { DrawingAssetReference, DrawingCollaborationTicket } from "../types";

export interface DrawingCollaborationSession {
  key: string;
  spaceId: string;
  drawingId: string;
  ticket: DrawingCollaborationTicket;
  doc: Y.Doc;
  elements: Y.Map<OrderedExcalidrawElement>;
  scene: Y.Map<unknown>;
  files: Y.Map<DrawingAssetReference>;
  provider: YProvider;
}

type SessionEntry = {
  refs: number;
  idleTimer: number | null;
  session?: DrawingCollaborationSession;
  promise?: Promise<DrawingCollaborationSession>;
};

const sessions = new Map<string, SessionEntry>();
const sessionIdleMs = 5 * 60 * 1000;

export async function acquireDrawingSession(
  spaceId: string,
  drawingId: string,
): Promise<DrawingCollaborationSession> {
  const key = `${spaceId}:${drawingId}`;
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

export function releaseDrawingSession(spaceId: string, drawingId: string): void {
  const key = `${spaceId}:${drawingId}`;
  const entry = sessions.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) {
    // Keep the warm document cache, but remove presence immediately so other
    // collaborators never see a five-minute "ghost" cursor.
    entry.session?.provider.awareness.setLocalState(null);
    scheduleIdleClose(key, entry);
  }
}

export function closeAllDrawingCollaborationSessions(): void {
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
  let unusedTicket = firstTicket.ticket;
  const doc = new Y.Doc();
  const url = new URL(firstTicket.url);
  const provider = new YProvider(url.host, firstTicket.room, doc, {
    party: "drawing-room",
    disableBc: true,
    params: async () => {
      if (unusedTicket) {
        const ticket = unusedTicket;
        unusedTicket = "";
        return { ticket };
      }
      const next = await drawingsApi.collaborationTicket(spaceId, drawingId);
      return { ticket: next.ticket };
    },
  });
  return {
    key,
    spaceId,
    drawingId,
    ticket: firstTicket,
    doc,
    elements: doc.getMap<OrderedExcalidrawElement>("drawing:elements"),
    scene: doc.getMap("drawing:scene"),
    files: doc.getMap<DrawingAssetReference>("drawing:files"),
    provider,
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

if (typeof window !== "undefined") {
  window.addEventListener(accountScopeResetEvent, closeAllDrawingCollaborationSessions);
}
