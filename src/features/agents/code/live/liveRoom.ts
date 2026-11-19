import type YProvider from "y-partyserver/provider";
import * as Y from "yjs";
import { spacesGateway, type RoomAccess } from "../../spaces-gateway/spacesGateway";
import { personColor } from "../../tutor/personTone";
import { codeSessionsApi } from "./codeSessionsApi";
import {
  authorKey,
  mainAuthor,
  type LivePerson,
  type LiveStep,
  type StepAuthor,
} from "./liveTypes";

/**
 * A session's shared doc and its connection to the Space's `code-room`, after
 * `noteCollaboration.ts`: one ticket to open it, a fresh one for each reconnect, and closed for
 * good once the session ends (the room drops it with `resource_deleted`).
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
  provider: YProvider;
  access: RoomAccess;
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
  room.provider.awareness.setLocalState(null);
  room.provider.destroy();
  room.doc.destroy();
}

async function createRoom(
  spaceId: string,
  sessionId: string,
  me: StepAuthor,
  person: Omit<LivePerson, keyof StepAuthor>,
): Promise<LiveRoom> {
  const ticket = await codeSessionsApi.collaborationTicket(spaceId, sessionId);
  // Undoing a step and attributing deletions both read deleted text, so nothing is collected.
  const doc = new Y.Doc({ gc: false });
  const { provider, access } = spacesGateway
    .get()
    .openCodeRoom(ticket, doc, () => codeSessionsApi.collaborationTicket(spaceId, sessionId));
  let ready = false;
  const room: LiveRoom = {
    sessionId,
    spaceId,
    doc,
    files: doc.getMap<Y.Text>("files"),
    steps: doc.getArray<LiveStep>("steps"),
    people: doc.getMap<LivePerson>("people"),
    users: new Y.PermanentUserData(doc),
    provider,
    access,
    me,
    ready: Promise.resolve(),
    isReady: () => ready,
  };
  const color = personColor(me.id);
  provider.awareness.setLocalStateField("user", {
    id: me.id,
    name: me.name,
    color,
    // y-codemirror tints others' selections with this; the person's own color, faint.
    colorLight: `color-mix(in srgb, ${color} 24%, transparent)`,
  });
  room.ready = synced(provider, access).then(() => {
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

/** How long a room has to sync before its join counts as failed, so a join never waits forever. */
const joinTimeoutMs = 30_000;

/**
 * Settles once the room's copy has arrived. Fails when the room is lost before then, or when it
 * hasn't synced in `joinTimeoutMs` (the provider retrying an unreachable server, a ticket refused).
 */
function synced(provider: YProvider, access: RoomAccess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (provider.synced) return resolve();
    const lostError = () =>
      new Error(
        access.lost === "deleted"
          ? "This session ended."
          : "You no longer have access to this session.",
      );
    if (access.lost) return reject(lostError());
    const finish = (error?: Error) => {
      provider.off("synced", done);
      unsubscribe();
      window.clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const done = (state: boolean) => {
      if (state) finish();
    };
    const unsubscribe = access.subscribe(() => {
      if (access.lost) finish(lostError());
    });
    const timer = window.setTimeout(
      () =>
        finish(new Error("Couldn't reach the live session. Check your connection and try again.")),
      joinTimeoutMs,
    );
    provider.on("synced", done);
  });
}
