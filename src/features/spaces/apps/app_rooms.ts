import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
  type Awareness,
} from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type YProvider from "y-partyserver/provider";
import { ApiRequestError } from "@/api/client";
import { spaceRequest } from "../api/api";
import { createYjsProvider, type CollaborationAccess } from "../journal/notes/create_yjs_provider";
import { HostError } from "./protocol";
import type { FileRoomSession } from "./app_file_rooms";

interface RoomTicket {
  ticket: string;
  room: string;
  url: string;
}

const FROM_APP = Symbol("misty-app-room");

const ROOM_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

const FILE_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

const FILE_ROOM = "file/";

export const IDENTITY_FIELD = "misty";

export interface RoomIdentity {
  user_id: string;
  name: string;
  tone: string | null;
}

export interface HostRoom {
  doc: Y.Doc;
  awareness: Awareness;
  synced: Promise<void>;
  lost(): "deleted" | "revoked" | null;
  onLost(listener: () => void): () => void;
  onReconnect?(listener: () => void): () => void;
  send?(message: string): void;
  onMessage?(listener: (message: string) => void): () => void;
  close(): void;
}

export type RoomSource = (id: string, options: { gc: boolean }) => Promise<HostRoom>;

export type FileRoomOpener = (
  fileId: string,
  options: { gc: boolean },
  emit: (data: unknown) => void,
) => Promise<FileRoomSession>;

export function providerRoom(
  opened: { provider: YProvider; access: CollaborationAccess },
  doc: Y.Doc,
): HostRoom {
  const { provider, access } = opened;
  provider.awareness.setLocalState(null);
  let wasSynced = provider.synced;
  const synced = provider.synced
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const onSync = (done: boolean) => {
          if (!done) return;
          wasSynced = true;
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
    onReconnect(listener) {
      let down = false;
      const onStatus = ({ status }: { status: string }) => {
        if (status === "disconnected" && wasSynced) down = true;
      };
      const onSync = (done: boolean) => {
        if (!done || !down) return;
        down = false;
        listener();
      };
      provider.on("status", onStatus);
      provider.on("sync", onSync);
      return () => {
        provider.off("status", onStatus);
        provider.off("sync", onSync);
      };
    },
    send: (message) => provider.sendMessage(message),
    onMessage(listener) {
      const onCustom = (message: string) => listener(message);
      provider.on("custom-message", onCustom);
      return () => provider.off("custom-message", onCustom);
    },
    close() {
      provider.destroy();
      doc.destroy();
    },
  };
}

export function appRoomSource(spaceId: string, appId: string): RoomSource {
  const ticket = (id: string) =>
    spaceRequest<RoomTicket>(
      `/spaces/${encodeURIComponent(spaceId)}/apps/${encodeURIComponent(appId)}/rooms/${encodeURIComponent(id)}/collaboration-ticket`,
      { method: "POST" },
    );
  return async (id, { gc }) => {
    const first = await ticket(id);
    const doc = new Y.Doc({ gc });
    return providerRoom(
      createYjsProvider(first, doc, "app-room", () => ticket(id)),
      doc,
    );
  };
}

const lostError = (reason: "deleted" | "revoked" | null) =>
  reason === "deleted"
    ? new HostError("not_found", "The room was deleted.")
    : new HostError("permission_denied", "You no longer have access to this room.");

export function openError(error: unknown): HostError {
  if (error instanceof HostError) return error;
  if (error instanceof ApiRequestError && error.status === 404) return lostError("deleted");
  if (error instanceof ApiRequestError && error.status === 403) return lostError("revoked");
  return new HostError(
    "internal",
    "The room couldn't be opened. Check your connection and try again.",
  );
}

function stampAwareness(
  update: Uint8Array,
  identity: RoomIdentity,
  mayWrite: (client: number) => boolean,
): Uint8Array | null {
  const decoder = decoding.createDecoder(update);
  const entries: [number, number, string][] = [];
  const count = decoding.readVarUint(decoder);
  for (let index = 0; index < count; index += 1) {
    const client = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const json = decoding.readVarString(decoder);
    if (!mayWrite(client)) continue;
    const state: unknown = JSON.parse(json);
    const stamped =
      state === null
        ? null
        : {
            ...(typeof state === "object" && !Array.isArray(state)
              ? (state as Record<string, unknown>)
              : {}),
            [IDENTITY_FIELD]: identity,
          };
    entries.push([client, clock, JSON.stringify(stamped)]);
  }
  if (!entries.length) return null;
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const [client, clock, json] of entries) {
    encoding.writeVarUint(encoder, client);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, json);
  }
  return encoding.toUint8Array(encoder);
}

const syncMessageOf = (write: (encoder: encoding.Encoder) => void) => {
  const encoder = encoding.createEncoder();
  write(encoder);
  return encoding.toUint8Array(encoder);
};

interface OpenRoom {
  room?: HostRoom;
  ready: Promise<HostRoom>;
  file?: FileRoomSession;
  queued: { kind: "update" | "awareness"; bytes: Uint8Array }[];
}

export interface AppRoomsOptions {
  identity: RoomIdentity;
  source?: RoomSource;
  files?: FileRoomOpener;
}

export function createAppRooms(spaceId: string, appId: string, options: AppRoomsOptions) {
  const source = options.source ?? appRoomSource(spaceId, appId);
  const { identity } = options;
  const rooms = new Map<string, OpenRoom>();
  const appClients = new Map<string, Set<number>>();
  const roomId = (params: Record<string, unknown>) => {
    const id = params.id;
    const valid =
      typeof id === "string" &&
      (ROOM_ID.test(id) || (id.startsWith(FILE_ROOM) && FILE_ID.test(id.slice(FILE_ROOM.length))));
    if (!valid) throw new HostError("invalid", "That isn't a room id.");
    return id;
  };
  const opened = (params: Record<string, unknown>) => {
    const open = rooms.get(roomId(params));
    if (!open) throw new HostError("invalid", "Join the room first.");
    return open;
  };
  const bytes = (value: unknown, what = "The update") => {
    const tag = Object.prototype.toString.call(value);
    if (tag === "[object Uint8Array]") {
      const view = value as Uint8Array;
      return value instanceof Uint8Array
        ? view
        : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    if (tag === "[object ArrayBuffer]") return new Uint8Array(value as ArrayBuffer);
    throw new HostError("invalid", `${what} is missing.`);
  };
  const apply = (id: string, room: HostRoom, kind: "update" | "awareness", update: Uint8Array) => {
    if (kind === "update") {
      Y.applyUpdate(room.doc, update, FROM_APP);
      return;
    }
    const mine = appClients.get(id) ?? new Set<number>();
    const states = room.awareness.getStates();
    const stamped = stampAwareness(
      update,
      identity,
      (client) => client !== room.awareness.clientID && (mine.has(client) || !states.has(client)),
    );
    if (stamped) applyAwarenessUpdate(room.awareness, stamped, FROM_APP);
  };
  const take = (kind: "update" | "awareness") => async (params: Record<string, unknown>) => {
    const id = roomId(params);
    const open = opened(params);
    const update = bytes(params.update);
    if (open.room) apply(id, open.room, kind, update);
    else open.queued.push({ kind, bytes: update });
  };

  return {
    calls: {
      "room.update": take("update"),
      "room.awareness": take("awareness"),
      "room.sync": async (params: Record<string, unknown>) => {
        const open = opened(params);
        const message = bytes(params.message, "The sync message");
        const room = await open.ready;
        await room.synced;
        const reply = encoding.createEncoder();
        const type = syncProtocol.readSyncMessage(
          decoding.createDecoder(message),
          reply,
          room.doc,
          FROM_APP,
        );
        const messages: Uint8Array[] = [];
        if (encoding.length(reply) > 0) messages.push(encoding.toUint8Array(reply));
        if (type === syncProtocol.messageYjsSyncStep1)
          messages.push(syncMessageOf((encoder) => syncProtocol.writeSyncStep1(encoder, room.doc)));
        return { messages };
      },
      "room.serialized": async (params: Record<string, unknown>) => {
        const open = opened(params);
        if (!open.file) throw new HostError("invalid", "That room isn't a file.");
        const request = params.request;
        if (typeof request !== "number" || !Number.isSafeInteger(request))
          throw new HostError("invalid", "The request is missing.");
        if (typeof params.error === "string")
          return open.file.serializeFailed(request, params.error);
        await open.file.serialized(request, bytes(params.data, "The file's bytes"));
      },
    },
    subscribe(
      params: Record<string, unknown>,
      emit: (data: unknown) => void,
      end: (error?: unknown) => void,
    ): () => void {
      const fileId = params.file;
      const isFile = fileId !== undefined;
      if (isFile && (typeof fileId !== "string" || !FILE_ID.test(fileId)))
        throw new HostError("invalid", "That isn't a file.");
      const openFile = options.files;
      if (isFile && !openFile)
        throw new HostError("unsupported", "Files can't be opened as live documents here.");
      const id = isFile ? `${FILE_ROOM}${fileId as string}` : roomId(params);
      if (!isFile && id.startsWith(FILE_ROOM))
        throw new HostError("invalid", "That isn't a room id.");
      if (rooms.has(id)) throw new HostError("conflict", "The app is already in that room.");
      const syncs = params.sync === true;
      const gc = params.gc !== false;
      let resolveReady!: (room: HostRoom) => void;
      let rejectReady!: (error: unknown) => void;
      const entry: OpenRoom = {
        queued: [],
        ready: new Promise<HostRoom>((resolve, reject) => {
          resolveReady = resolve;
          rejectReady = reject;
        }),
      };
      entry.ready.catch(() => undefined);
      rooms.set(id, entry);
      const mine = new Set<number>();
      appClients.set(id, mine);
      let closed = false;
      const stops: (() => void)[] = [];
      const leave = () => {
        if (closed) return;
        closed = true;
        rooms.delete(id);
        appClients.delete(id);
        for (const stop of stops.splice(0)) stop();
        rejectReady(new HostError("cancelled", "The app left the room."));
        entry.file?.close();
        const room = entry.room;
        if (!room) return;
        const present = [...mine].filter((client) => room.awareness.getStates().has(client));
        if (present.length) removeAwarenessStates(room.awareness, present, FROM_APP);
        if (!entry.file) room.close();
      };

      const opening =
        isFile && openFile
          ? openFile(fileId as string, { gc }, emit).then((session) => {
              entry.file = session;
              return session.room;
            })
          : source(id, { gc });

      void opening
        .then((room) => {
          if (closed) {
            if (entry.file) entry.file.close();
            else room.close();
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
              for (const client of [...added, ...updated]) mine.add(client);
              for (const client of removed) mine.delete(client);
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
          for (const { kind, bytes: queued } of entry.queued.splice(0))
            apply(id, room, kind, queued);
          if (room.lost()) {
            const error = lostError(room.lost());
            leave();
            end(error);
            return;
          }
          void room.synced.then(() => {
            if (closed) return;
            if (syncs)
              emit({
                type: "message",
                message: syncMessageOf((encoder) => syncProtocol.writeSyncStep1(encoder, room.doc)),
              });
            else emit({ type: "sync", update: Y.encodeStateAsUpdate(room.doc) });
            room.doc.on("update", onUpdate);
            stops.push(() => room.doc.off("update", onUpdate));
            if (syncs && room.onReconnect)
              stops.push(
                room.onReconnect(() => {
                  if (closed) return;
                  emit({
                    type: "message",
                    message: syncMessageOf((encoder) =>
                      syncProtocol.writeSyncStep1(encoder, room.doc),
                    ),
                  });
                }),
              );
            resolveReady(room);
            entry.file?.started();
            const others = [...room.awareness.getStates().keys()].filter(
              (client) => !mine.has(client),
            );
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
