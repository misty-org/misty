import { accountScopeResetEvent } from "@/features/account";
import type YProvider from "y-partyserver/provider";
import * as Y from "yjs";
import { createYjsProvider, type CollaborationAccess } from "../journal/notes/createYjsProvider";
import { workbooksApi, type WorkbookCollaborationTicket } from "./api";
import { localEditOrigin } from "./editOrigin";
import { WorkbookEngine } from "./formula/engine";
import { chartsKey, dashboardKey, metaKey, sheetOrderKey, sheetsKey } from "./workbook/schema";

export { localEditOrigin } from "./editOrigin";

/** One open workbook room, shared by every view of it in this window (page, embeds, slides). */
export interface WorkbookSession {
  key: string;
  spaceId: string;
  workbookId: string;
  doc: Y.Doc;
  provider: YProvider;
  /** What the room lets this person do, over the workbook's own role. */
  role?: WorkbookCollaborationTicket["role"];
  access: CollaborationAccess;
  /** The formulas' values, computed here; made on first use. */
  engine(): WorkbookEngine;
  /** This person's undo, which never undoes anyone else's edits. */
  undo(): Y.UndoManager;
}

type SessionEntry = {
  refs: number;
  presenceRefs: number;
  idleTimer: number | null;
  session?: WorkbookSession;
  promise?: Promise<WorkbookSession>;
};

const sessions = new Map<string, SessionEntry>();
const sessionIdleMs = 5 * 60 * 1000;
const sessionKey = (spaceId: string, workbookId: string) => `${spaceId}:${workbookId}`;

export async function acquireWorkbookSession(
  spaceId: string,
  workbookId: string,
  options?: { publishPresence?: boolean },
): Promise<WorkbookSession> {
  const key = sessionKey(spaceId, workbookId);
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

  const owned = entry;
  entry.promise = createSession(spaceId, workbookId, key)
    .then((session) => {
      if (sessions.get(key) !== owned) {
        destroySession(session);
        throw new Error("The workbook's live room was closed.");
      }
      owned.session = session;
      owned.promise = undefined;
      if (owned.refs === 0) scheduleIdleClose(key, owned);
      return session;
    })
    .catch((error) => {
      if (sessions.get(key) === owned) sessions.delete(key);
      throw error;
    });
  return entry.promise;
}

export function releaseWorkbookSession(
  spaceId: string,
  workbookId: string,
  options?: { publishPresence?: boolean },
): void {
  const key = sessionKey(spaceId, workbookId);
  const entry = sessions.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (options?.publishPresence !== false) {
    entry.presenceRefs = Math.max(0, entry.presenceRefs - 1);
    if (entry.presenceRefs === 0) entry.session?.provider.awareness.setLocalState(null);
  }
  if (entry.refs === 0) scheduleIdleClose(key, entry);
}

/** Closes a workbook's room at once, after it was deleted here. */
export function closeWorkbookCollaborationSession(spaceId: string, workbookId: string): void {
  const key = sessionKey(spaceId, workbookId);
  const entry = sessions.get(key);
  if (!entry) return;
  sessions.delete(key);
  clearIdleTimer(entry);
  if (entry.session) destroySession(entry.session);
}

function closeAllSessions(): void {
  for (const [, entry] of sessions) {
    clearIdleTimer(entry);
    if (entry.session) destroySession(entry.session);
  }
  sessions.clear();
}

async function createSession(
  spaceId: string,
  workbookId: string,
  key: string,
): Promise<WorkbookSession> {
  const firstTicket = await workbooksApi.collaborationTicket(spaceId, workbookId);
  const doc = new Y.Doc();
  const { provider, access } = createYjsProvider(firstTicket, doc, "workbook-room", () =>
    workbooksApi.collaborationTicket(spaceId, workbookId),
  );
  // Nobody shows as here until a view publishes who they are: an embed never does.
  provider.awareness.setLocalState(null);
  let engine: WorkbookEngine | null = null;
  let undo: Y.UndoManager | null = null;
  return {
    key,
    spaceId,
    workbookId,
    doc,
    provider,
    role: firstTicket.role,
    access,
    engine: () => (engine ??= new WorkbookEngine(doc)),
    undo: () =>
      (undo ??= new Y.UndoManager(
        [
          doc.getMap(metaKey),
          doc.getArray(sheetOrderKey),
          doc.getMap(sheetsKey),
          doc.getMap(chartsKey),
          doc.getArray(dashboardKey),
        ],
        { trackedOrigins: new Set([localEditOrigin]), captureTimeout: 400 },
      )),
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

function destroySession(session: WorkbookSession): void {
  session.provider.destroy();
  session.doc.destroy();
}

/** A deleted workbook's open copy stops syncing at once, without waiting for the room. */
function closeDeletedWorkbook(event: Event): void {
  const detail = (
    event as CustomEvent<{
      type?: string;
      space_id?: string;
      entity_id?: string;
      payload?: unknown;
    }>
  ).detail;
  if (detail?.type !== "workbook.deleted" || !detail.space_id) return;
  const payloadId = (detail.payload as { workbook_id?: unknown } | undefined)?.workbook_id;
  const workbookId = typeof payloadId === "string" ? payloadId : detail.entity_id;
  if (typeof workbookId !== "string") return;
  sessions.get(sessionKey(detail.space_id, workbookId))?.session?.access.lose("deleted");
}

if (typeof window !== "undefined") {
  window.addEventListener(accountScopeResetEvent, closeAllSessions);
  window.addEventListener("misty:space-workbook-event", closeDeletedWorkbook);
}
