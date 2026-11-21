import type { Room } from "@misty/sdk";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import { personColor } from "../../tutor/personTone";
import { useCursorTone, useShowInLive } from "./liveVisibility";
import {
  authorKey,
  mainAuthor,
  type LivePerson,
  type LiveStep,
  type StepAuthor,
} from "./liveTypes";

/**
 * A session's shared doc, a room of misty-sdk's like any app's (`pageMisty(…, "code")`): the room id is the
 * session's, the host opens the Space's `code-room` behind it, and the room stops for good once the session
 * ends (`not_found`) or the person can no longer reach it (`permission_denied`).
 *
 * Attribution rides on Yjs's own client ids. The person's edits use the doc's client id; each of
 * their agents, main's conflicts and file seeds get client ids of their own, switched in only for
 * that transaction, and `Y.PermanentUserData` maps every id but the seeds' to its author. So the
 * text itself says who wrote each character and who deleted it, on every member's copy, and a
 * seeded file's text (the base commit's) belongs to no one.
 */

/** Why a transaction was made, and for whom. Edits from the editor carry y-codemirror's origin. */
export class LiveOrigin {
  constructor(
    readonly author: StepAuthor,
    readonly reason: "disk" | "undo" | "main" | "seed" | "step" | "people",
  ) {}
}

/** Whether a session's room is still reachable; once lost, it stays closed. */
export interface LiveAccess {
  readonly lost: "deleted" | "revoked" | null;
  subscribe(listener: () => void): () => void;
}

export interface LiveRoom {
  sessionId: string;
  spaceId: string;
  doc: Y.Doc;
  /** Repository path → its shared text. */
  files: Y.Map<Y.Text>;
  steps: Y.Array<LiveStep>;
  /** Author key → who they are. */
  people: Y.Map<LivePerson>;
  users: Y.PermanentUserData;
  /** The SDK room the doc lives in. */
  live: Room;
  /** Everyone in the session now: their names, colors, files and carets. */
  awareness: Awareness;
  access: LiveAccess;
  me: StepAuthor;
  /**
   * Settles once the room has synced and this window's authors are mapped; fails when the room is
   * lost first or can't be reached in time.
   */
  ready: Promise<void>;
  isReady(): boolean;
}

/** Client ids this window writes as, by author key. The person's own is the doc's. */
const authorClients = new WeakMap<Y.Doc, Map<string, number>>();

const randomClient = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

/** Whose transaction it is: an origin of ours says; anything else local is the person's. */
export function transactionAuthor(room: LiveRoom, transaction: Y.Transaction): StepAuthor {
  const origin = transaction.origin;
  return origin instanceof LiveOrigin ? origin.author : room.me;
}

function mapAuthor(room: LiveRoom, client: number, author: StepAuthor) {
  const key = authorKey(author);
  room.users.setUserMapping(room.doc, client, key, {
    filter: (transaction) => authorKey(transactionAuthor(room, transaction)) === key,
  });
  if (!room.people.has(key)) {
    room.doc.transact(() => room.people.set(key, { ...author }), new LiveOrigin(room.me, "people"));
  }
}

function clientFor(room: LiveRoom, author: StepAuthor): number {
  const key = authorKey(author);
  if (key === authorKey(room.me)) return room.doc.clientID;
  let clients = authorClients.get(room.doc);
  if (!clients) authorClients.set(room.doc, (clients = new Map()));
  let client = clients.get(key);
  if (client === undefined) {
    client = randomClient();
    clients.set(key, client);
    mapAuthor(room, client, author);
  }
  return client;
}

/** Runs one transaction as `client`, then gives the doc its own id back. */
function asClient(doc: Y.Doc, client: number, work: () => void) {
  const own = doc.clientID;
  if (client === own) return work();
  doc.clientID = client;
  try {
    work();
  } finally {
    doc.clientID = own;
  }
}

/** One change written as `author`, attributed to them in the text. */
export function transactAs(
  room: LiveRoom,
  author: StepAuthor,
  reason: LiveOrigin["reason"],
  work: () => void,
) {
  const client = clientFor(room, author);
  asClient(room.doc, client, () => room.doc.transact(work, new LiveOrigin(author, reason)));
}

/** A file's first text, as it was at the base commit: written by a client no one owns. */
export function seedAs(room: LiveRoom, work: () => void) {
  asClient(room.doc, randomClient(), () =>
    room.doc.transact(work, new LiveOrigin(room.me, "seed")),
  );
}

/** Main's conflicts, written as main. */
export function transactAsMain(room: LiveRoom, work: () => void) {
  transactAs(room, mainAuthor, "main", work);
}

/** Who wrote the character with this client id: an author key, or null for seeded text. */
export const writerOf = (room: LiveRoom, client: number): string | null =>
  (room.users.getUserByClientId(client) as string | null) ?? null;

const rooms = new Map<string, Promise<LiveRoom>>();
const open = new Map<string, LiveRoom>();

/** The room this window has open for a session, once it is open. */
export const openRoom = (sessionId: string): LiveRoom | undefined => open.get(sessionId);

/** Opens a session's room, or returns the one already open. */
export function acquireRoom(
  spaceId: string,
  sessionId: string,
  me: StepAuthor,
  person: Omit<LivePerson, keyof StepAuthor>,
): Promise<LiveRoom> {
  let found = rooms.get(sessionId);
  if (!found) {
    found = createRoom(spaceId, sessionId, me, person);
    rooms.set(sessionId, found);
    found.then(
      (room) => open.set(sessionId, room),
      () => rooms.delete(sessionId),
    );
  }
  return found;
}

/** Closes a session's room in this window. */
export function closeRoom(sessionId: string) {
  const room = open.get(sessionId);
  rooms.delete(sessionId);
  open.delete(sessionId);
  if (!room) return;
  room.awareness.setLocalState(null);
  room.live.destroy();
}

async function createRoom(
  spaceId: string,
  sessionId: string,
  me: StepAuthor,
  person: Omit<LivePerson, keyof StepAuthor>,
): Promise<LiveRoom> {
  // Undoing a step and attributing deletions both read deleted text, so nothing is collected.
  const live = spacesGateway.get().pageMisty(spaceId, "code").room(sessionId, { gc: false });
  const doc = live.doc;
  const access = liveAccess(live);
  let ready = false;
  const room: LiveRoom = {
    sessionId,
    spaceId,
    doc,
    files: doc.getMap<Y.Text>("files"),
    steps: doc.getArray<LiveStep>("steps"),
    people: doc.getMap<LivePerson>("people"),
    users: new Y.PermanentUserData(doc),
    live,
    awareness: live.awareness,
    access,
    me,
    ready: Promise.resolve(),
    isReady: () => ready,
  };
  const tone = useCursorTone.getState().value;
  const color = tone === "auto" ? personColor(me.id) : `var(--color-tone-${tone})`;
  // Left unpublished, others see neither this person's cursor nor their face in the session.
  if (useShowInLive.getState().value)
    live.awareness.setLocalStateField("user", {
      id: me.id,
      name: me.name,
      color,
      // y-codemirror tints others' selections with this; the person's own color, faint.
      colorLight: `color-mix(in srgb, ${color} 24%, transparent)`,
    });
  room.ready = synced(live, access).then(() => {
    // Mapped only after sync, so an entry another member's copy already has isn't replaced.
    mapAuthor(room, doc.clientID, me);
    doc.transact(
      () => room.people.set(authorKey(me), { ...me, ...person }),
      new LiveOrigin(me, "people"),
    );
    ready = true;
  });
  return room;
}

/** A room's loss as Code tells it: the session ended, or this person can no longer reach it. */
function liveAccess(live: Room): LiveAccess {
  return {
    get lost() {
      const code = live.lost?.code;
      return code === "not_found" ? "deleted" : code === "permission_denied" ? "revoked" : null;
    },
    subscribe: (listener) => live.onLost(() => listener()),
  };
}

/** How long a room has to sync before its join counts as failed, so a join never waits forever. */
const joinTimeoutMs = 30_000;

/**
 * Settles once the room's copy has arrived. Fails when the room is lost before then, or when it
 * hasn't synced in `joinTimeoutMs` (the server out of reach, a ticket refused).
 */
function synced(live: Room, access: LiveAccess): Promise<void> {
  return new Promise((resolve, reject) => {
    const lostError = () =>
      new Error(
        access.lost === "deleted"
          ? "This session ended."
          : access.lost === "revoked"
            ? "You no longer have access to this session."
            : "Couldn't reach the live session. Check your connection and try again.",
      );
    const timer = window.setTimeout(
      () =>
        reject(new Error("Couldn't reach the live session. Check your connection and try again.")),
      joinTimeoutMs,
    );
    live.synced.then(
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      () => {
        window.clearTimeout(timer);
        reject(lostError());
      },
    );
  });
}
