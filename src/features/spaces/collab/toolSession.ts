import * as encoding from "lib0/encoding";
import type YProvider from "y-partyserver/provider";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { createYjsProvider, type CollaborationAccess } from "../journal/notes/createYjsProvider";
import { notePendingVersion } from "../journal/notes/markdown/materializeNoteMarkdown";
import { requestRoomTicket, roomParty, type RoomItemKind } from "./itemRooms";

export {
  materializeNoteMarkdown,
  noteToolOrigin,
} from "../journal/notes/markdown/materializeNoteMarkdown";

/*
 * Tool sessions: the tool host (agents' Space tools) joins an item's room as one more Yjs
 * client with the person's editor ticket, changes the document with the same model code the
 * editors use, waits until the room holds the change, and leaves. So an item an agent makes or
 * changes is complete at once, not only once someone opens it (plan F3).
 */

export type ToolDocKind = RoomItemKind;

export type ToolSessionErrorCode =
  "read_only" | "sync_timeout" | "ack_timeout" | "access_lost" | "aborted";

/** Why a tool session failed, in words an agent can act on. */
export class ToolSessionError extends Error {
  constructor(
    readonly code: ToolSessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolSessionError";
  }
}

export interface ToolDocOptions {
  /** How long joining, and then the room's acknowledgement, may each take. Default 15 s. */
  timeoutMs?: number;
  /** Only read: a viewer's ticket is enough and nothing is waited for afterwards. */
  readOnly?: boolean;
  signal?: AbortSignal;
}

const defaultTimeoutMs = 15_000;
/** How long a note's pending markdown may stay with another open editor before going on. */
const pendingLeaseWaitMs = 5_000;
const messageSync = 0;

const itemNames: Record<ToolDocKind, string> = {
  note: "doc",
  drawing: "whiteboard",
  deck: "deck",
  workbook: "data item",
};

/**
 * Joins the item's room, waits for its content, runs `fn(doc)` and, when `fn` changed the doc,
 * waits until the room has every local update before leaving. `fn` may be async; the model
 * functions it calls (applyDeckOps, applyWorkbookOps, materializeNoteMarkdown, …) each make
 * their own single transaction. Throws `ToolSessionError` on a timeout, a lost room or a
 * view-only ticket.
 */
export async function withToolDoc<T>(
  kind: ToolDocKind,
  spaceId: string,
  itemId: string,
  fn: (doc: Y.Doc) => T | Promise<T>,
  options: ToolDocOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const name = itemNames[kind];
  throwIfAborted(options.signal);
  const ticket = await requestRoomTicket(kind, spaceId, itemId);
  if (!options.readOnly && ticket.role === "viewer") {
    throw new ToolSessionError(
      "read_only",
      `This ${name} can only be viewed, so it can't be changed.`,
    );
  }
  throwIfAborted(options.signal);
  const doc = new Y.Doc();
  const { provider, access } = createYjsProvider(ticket, doc, roomParty(kind), () =>
    requestRoomTicket(kind, spaceId, itemId),
  );
  // A tool session never shows up as a collaborator.
  provider.awareness.setLocalState(null);
  try {
    await waitForSync(provider, access, timeoutMs, name, options.signal);
    if (kind === "note" && !options.readOnly) await settlePendingMarkdown(provider, doc);
    let changed = false;
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== provider) changed = true;
    };
    doc.on("update", onUpdate);
    let result: T;
    try {
      result = await fn(doc);
    } finally {
      doc.off("update", onUpdate);
    }
    if (changed && !options.readOnly) {
      await confirmWithRoom(provider, access, timeoutMs, name, options.signal);
    }
    return result;
  } finally {
    provider.disconnect();
    provider.destroy();
    doc.destroy();
  }
}

/** Joins the room read-only, reads with `fn`, and leaves: for pickers and previews. */
export function readToolDoc<T>(
  kind: ToolDocKind,
  spaceId: string,
  itemId: string,
  fn: (doc: Y.Doc) => T | Promise<T>,
  options: Omit<ToolDocOptions, "readOnly"> = {},
): Promise<T> {
  return withToolDoc(kind, spaceId, itemId, fn, { ...options, readOnly: true });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ToolSessionError("aborted", "The tool call was stopped.");
}

/** Resolves once the provider holds the room's content. */
function waitForSync(
  provider: YProvider,
  access: CollaborationAccess,
  timeoutMs: number,
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  if (provider.synced) return Promise.resolve();
  return waitFor(provider, access, timeoutMs, signal, {
    timeout: () =>
      new ToolSessionError(
        "sync_timeout",
        `The ${name} couldn't be opened in time. Check the connection and try again.`,
      ),
    name,
  });
}

/**
 * Resolves once the room has every update this copy sent. Messages on one socket are handled
 * in order, so the room answering a sync request sent after the updates means it has applied
 * them. A reconnect in between asks again on the new socket.
 */
async function confirmWithRoom(
  provider: YProvider,
  access: CollaborationAccess,
  timeoutMs: number,
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let reconnected = false;
    const onStatus = ({ status }: { status: string }) => {
      if (status !== "connected") reconnected = true;
    };
    provider.on("status", onStatus);
    try {
      const answered = waitFor(provider, access, timeoutMs, signal, {
        timeout: () =>
          new ToolSessionError(
            "ack_timeout",
            `The change to the ${name} wasn't confirmed in time. It may still arrive; read the ${name} again before retrying.`,
          ),
        name,
      });
      // Wait for the room's next answer, then ask for it.
      provider.synced = false;
      if (provider.ws && provider.wsconnected) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeSyncStep1(encoder, provider.doc);
        provider.ws.send(encoding.toUint8Array(encoder));
      }
      await answered;
    } finally {
      provider.off("status", onStatus);
    }
    if (!reconnected) return;
  }
}

function waitFor(
  provider: YProvider,
  access: CollaborationAccess,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  words: { timeout: () => ToolSessionError; name: string },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanups: Array<() => void> = [];
    const finish = (error?: Error) => {
      for (const cleanup of cleanups) cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onSync = (synced: boolean) => {
      if (synced) finish();
    };
    provider.on("sync", onSync);
    cleanups.push(() => provider.off("sync", onSync));
    const timer = setTimeout(() => finish(words.timeout()), timeoutMs);
    cleanups.push(() => clearTimeout(timer));
    cleanups.push(
      access.subscribe(() => {
        if (!access.lost) return;
        finish(
          new ToolSessionError(
            "access_lost",
            access.lost === "deleted"
              ? `This ${words.name} was deleted.`
              : `You no longer have access to this ${words.name}.`,
          ),
        );
      }),
    );
    if (signal) {
      const onAbort = () => finish(new ToolSessionError("aborted", "The tool call was stopped."));
      signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", onAbort));
    }
  });
}

/**
 * A note whose server markdown no copy has applied yet: ask the room for its lease the way an
 * editor does, so this session and an editor opening the doc right now don't both write the body.
 * Granted, the session goes on and its write marks the version applied. Held by an editor, the
 * session waits a little for that editor to apply it; the session's own write then only changes
 * what differs.
 */
async function settlePendingMarkdown(provider: YProvider, doc: Y.Doc): Promise<void> {
  const version = notePendingVersion(doc);
  if (!version) return;
  const metadata = doc.getMap<unknown>("misty:document");
  await new Promise<void>((resolve) => {
    const cleanups: Array<() => void> = [];
    const finish = () => {
      for (const cleanup of cleanups) cleanup();
      resolve();
    };
    const onLease = (message: string) => {
      let lease: { type?: unknown; version?: unknown; granted?: unknown };
      try {
        lease = JSON.parse(message) as typeof lease;
      } catch {
        return;
      }
      if (lease.type !== "pending_markdown_lease" || lease.version !== version) return;
      if (lease.granted === true) finish();
    };
    const onMetadata = () => {
      if (notePendingVersion(doc) !== version) finish();
    };
    provider.on("custom-message", onLease);
    cleanups.push(() => provider.off("custom-message", onLease));
    metadata.observe(onMetadata);
    cleanups.push(() => metadata.unobserve(onMetadata));
    const timer = setTimeout(finish, pendingLeaseWaitMs);
    cleanups.push(() => clearTimeout(timer));
    provider.sendMessage(JSON.stringify({ type: "claim_pending_markdown", version }));
  });
}
