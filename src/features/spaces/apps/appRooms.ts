import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
  type Awareness,
} from "y-protocols/awareness";
import * as Y from "yjs";
import type YProvider from "y-partyserver/provider";
import { ApiRequestError } from "@/api/client";
import { spaceRequest } from "../api/api";
import { createYjsProvider, type CollaborationAccess } from "../journal/notes/createYjsProvider";
import { HostError } from "./protocol";

interface RoomTicket {
  ticket: string;
  room: string;
  url: string;
}

/** What an app's own updates are marked with on the host's copy, so they aren't sent back to it. */
const FROM_APP = Symbol("misty-app-room");

const ROOM_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/** One of the Space server's live rooms, as the host holds it for an app or one of Misty's own pages. */
export interface HostRoom {
  doc: Y.Doc;
  awareness: Awareness;
  /** Settles once the room's copy has arrived. */
  synced: Promise<void>;
  /** Why the room stopped for good, once it has. */
  lost(): "deleted" | "revoked" | null;
  onLost(listener: () => void): () => void;
  /** Lets go of the room. */
  close(): void;
}

/**
 * Opens the server room behind one of an app's room ids. An installed app's ids name its own rooms; the Code
 * and Lab pages' ids name a live session or a notebook, whose rooms the server already keeps.
 */
export type RoomSource = (id: string, options: { gc: boolean }) => Promise<HostRoom>;

/**
 * A room the host opened a connection for itself. The host is no one in the room: its own awareness is
 * cleared, so the people the app shows are the app's own and the other members'.
 */
export function providerRoom(opened: { provider: YProvider; access: CollaborationAccess }, doc: Y.Doc): HostRoom {
  const { provider, access } = opened;
  provider.awareness.setLocalState(null);
  const synced = provider.synced
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const onSync = (done: boolean) => {
          if (!done) return;
          provider.off("sync", onSync);
          resolve();
        };
        provider.on("sync", onSync);
      });
  return {
    doc,
    awareness: provider.awareness,
    synced,
    lost: () => access.lost,
    onLost: (listener) => access.subscribe(listener),
    close() {
      provider.destroy();
      doc.destroy();
    },
  };
}

/** An installed app's rooms: each one the app's own on the Space's live relay, kept apart from other apps'. */
export function appRoomSource(spaceId: string, appId: string): RoomSource {
  const ticket = (id: string) =>
    spaceRequest<RoomTicket>(
      `/spaces/${encodeURIComponent(spaceId)}/apps/${encodeURIComponent(appId)}/rooms/${encodeURIComponent(id)}/collaboration-ticket`,
      { method: "POST" },
    );
  return async (id, { gc }) => {
    const first = await ticket(id);
    const doc = new Y.Doc({ gc });
    return providerRoom(createYjsProvider(first, doc, "app-room", () => ticket(id)), doc);
  };
}

/** Why a room stopped, as the code an app can act on. */
const lostError = (reason: "deleted" | "revoked" | null) =>
  reason === "deleted"
    ? new HostError("not_found", "The room was deleted.")
    : new HostError("permission_denied", "You no longer have access to this room.");

/** Why a room couldn't be opened: gone, not this person's, or the server out of reach. */
function openError(error: unknown): HostError {
  if (error instanceof HostError) return error;
  if (error instanceof ApiRequestError && error.status === 404) return lostError("deleted");
  if (error instanceof ApiRequestError && error.status === 403) return lostError("revoked");
  return new HostError("internal", "The room couldn't be opened. Check your connection and try again.");
}

interface OpenRoom {
  room?: HostRoom;
  /** What the app sent before the room was open, applied in order once it is. */
  queued: { kind: "update" | "awareness"; bytes: Uint8Array }[];
}

/**
 * An app's live documents (the SDK's `room()`): each a Yjs document on the Space's live relay, shared by everyone
 * in the Space who opens the same room. The host holds the connection, so the app's frame never reaches the
 * network; the app sends its changes and awareness here and hears everyone else's. Misty's own Code and Lab pages
 * hold their rooms the same way, through `source`.
 */
export function createAppRooms(spaceId: string, appId: string, source: RoomSource = appRoomSource(spaceId, appId)) {
  const rooms = new Map<string, OpenRoom>();
  const roomId = (params: Record<string, unknown>) => {
    const id = params.id;
    if (typeof id !== "string" || !ROOM_ID.test(id)) throw new HostError("invalid", "That isn't a room id.");
    return id;
  };
  // Bytes from the channel may come from another realm (a frame's, or a webview's own), where `instanceof`
  // fails; their tag doesn't.
  const bytes = (value: unknown) => {
    const tag = Object.prototype.toString.call(value);
    if (tag === "[object Uint8Array]") {
      const view = value as Uint8Array;
      return value instanceof Uint8Array ? view : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    if (tag === "[object ArrayBuffer]") return new Uint8Array(value as ArrayBuffer);
    throw new HostError("invalid", "The update is missing.");
  };
  const apply = (room: HostRoom, kind: "update" | "awareness", update: Uint8Array) => {
    if (kind === "update") Y.applyUpdate(room.doc, update, FROM_APP);
    else applyAwarenessUpdate(room.awareness, update, FROM_APP);
  };
  const take = (kind: "update" | "awareness") => async (params: Record<string, unknown>) => {
    const open = rooms.get(roomId(params));
    if (!open) throw new HostError("invalid", "Join the room first.");
    const update = bytes(params.update);
    if (open.room) apply(open.room, kind, update);
    else open.queued.push({ kind, bytes: update });
  };

  return {
    calls: {
      "room.update": take("update"),
      "room.awareness": take("awareness"),
    },
    /**
     * Joins a room for the app: its whole state once it has arrived, then everyone's changes and awareness as
     * they come. `end` says why, if the room stops on its own.
     */
    subscribe(
      params: Record<string, unknown>,
      emit: (data: unknown) => void,
      end: (error?: unknown) => void,
    ): () => void {
      const id = roomId(params);
      if (rooms.has(id)) throw new HostError("conflict", "The app is already in that room.");
      const entry: OpenRoom = { queued: [] };
      rooms.set(id, entry);
      let closed = false;
      // The awareness clients the app brought into the room, so they leave with it.
      const appClients = new Set<number>();
      const stops: (() => void)[] = [];
      const leave = () => {
        if (closed) return;
        closed = true;
        rooms.delete(id);
        for (const stop of stops.splice(0)) stop();
        const room = entry.room;
        if (!room) return;
        const present = [...appClients].filter((client) => room.awareness.getStates().has(client));
        if (present.length) removeAwarenessStates(room.awareness, present, FROM_APP);
        room.close();
      };

      void source(id, { gc: params.gc !== false })
        .then((room) => {
          if (closed) {
            room.close();
            return;
          }
          entry.room = room;
          const onUpdate = (update: Uint8Array, origin: unknown) => {
            if (origin !== FROM_APP && !closed) emit({ type: "sync", update });
          };
          const onAwareness = (
            { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
            origin: unknown,
          ) => {
            if (closed) return;
            if (origin === FROM_APP) {
              for (const client of [...added, ...updated]) appClients.add(client);
              for (const client of removed) appClients.delete(client);
              return;
            }
            emit({
              type: "awareness",
              update: encodeAwarenessUpdate(room.awareness, [...added, ...updated, ...removed]),
            });
          };
          room.awareness.on("update", onAwareness);
          stops.push(() => room.awareness.off("update", onAwareness));
          stops.push(
            room.onLost(() => {
              if (closed || !room.lost()) return;
              const error = lostError(room.lost());
              leave();
              end(error);
            }),
          );
          for (const { kind, bytes: queued } of entry.queued.splice(0)) apply(room, kind, queued);
          if (room.lost()) {
            const error = lostError(room.lost());
            leave();
            end(error);
            return;
          }
          void room.synced.then(() => {
            if (closed) return;
            // The room's whole state once it has arrived, with everyone already in it; each change after it.
            emit({ type: "sync", update: Y.encodeStateAsUpdate(room.doc) });
            room.doc.on("update", onUpdate);
            stops.push(() => room.doc.off("update", onUpdate));
            const others = [...room.awareness.getStates().keys()].filter((client) => !appClients.has(client));
            if (others.length)
              emit({ type: "awareness", update: encodeAwarenessUpdate(room.awareness, others) });
          });
        })
        .catch((error: unknown) => {
          if (closed) return;
          leave();
          end(openError(error));
        });
      return leave;
    },
  };
}
