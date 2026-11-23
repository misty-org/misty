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
import {
  createYjsProvider,
  firstCollaborationTicket,
  requestCollaborationTicket,
  withTimeout,
  type CollaborationAccess,
  type CollaborationProblem,
} from "../journal/notes/create_yjs_provider";
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

const DOTS_ONLY = /^\.+$/;

const FILE_ROOM = "file/";

export const ROOM_STALL_MS = 20_000;

const MAX_APP_CLIENTS = 16;

const RETIRED_KEPT = 64;

export const ROOM_FEATURES = ["room.connection", "room.problem"] as const;

export const IDENTITY_FIELD = "misty";

export interface RoomIdentity {
  user_id: string;
  name: string;
  tone: string | null;
}

export interface RoomProblem {
  code: string;
  message: string;
}

export interface HostRoom {
  doc: Y.Doc;
  awareness: Awareness;
  synced: Promise<void>;
  lost(): "deleted" | "revoked" | null;
  moved?(): boolean;
  onLost(listener: () => void): () => void;
  onConnection?(listener: (connected: boolean) => void): () => void;
  onProblem?(listener: (problem: RoomProblem) => void): () => void;
  resend?(clients: number[]): void;
  send?(message: string): boolean;
  onMessage?(listener: (message: string) => void): () => void;
  close(): void;
}

export type RoomSource = (
  id: string,
  options: { gc: boolean; signal?: AbortSignal },
) => Promise<HostRoom>;

export type FileRoomOpener = (
  fileId: string,
  options: { gc: boolean; signal?: AbortSignal },
  emit: (data: unknown) => void,
  fail: (error: HostError) => void,
) => Promise<FileRoomSession>;

const PROBLEMS: Record<CollaborationProblem, RoomProblem> = {
  too_large: {
    code: "too_large",
    message: "This room is bigger than the server takes, so changes here aren't being saved.",
  },
  room_full: {
    code: "stalled",
    message: "This room is full right now. Misty keeps trying to join it.",
  },
};

const SIZE_PROBLEMS: Record<"blocked" | "warning", RoomProblem> = {
  blocked: {
    code: "too_large",
    message: "This room reached the server's size limit, so the latest changes weren't saved.",
  },
  warning: {
    code: "too_large_warning",
    message: "This room is close to the server's size limit.",
  },
};

export function providerRoom(
  opened: { provider: YProvider; access: CollaborationAccess },
  doc: Y.Doc,
): HostRoom {
  const { provider, access } = opened;
  provider.awareness.setLocalState(null);
  let link: "opening" | "up" | "down" = provider.synced ? "up" : "opening";
  const connection = new Set<(connected: boolean) => void>();
  const synced =
    link === "up"
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const onSync = (done: boolean) => {
            if (!done) return;
            provider.off("sync", onSync);
            resolve();
          };
          provider.on("sync", onSync);
        });
  provider.on("sync", (done: boolean) => {
    if (!done) return;
    const was = link;
    link = "up";
    if (was === "down") for (const listener of [...connection]) listener(true);
  });
  provider.on("status", ({ status }: { status: string }) => {
    if (status !== "disconnected" || link !== "up") return;
    link = "down";
    for (const listener of [...connection]) listener(false);
  });
  return {
    doc,
    awareness: provider.awareness,
    synced,
    lost: () => access.lost,
    moved: () => access.moved === true,
    onLost: (listener) => access.subscribe(listener),
    onConnection(listener) {
      connection.add(listener);
      return () => connection.delete(listener);
    },
    onProblem(listener) {
      if (access.problem) listener(PROBLEMS[access.problem]);
      return access.onProblem((problem) => {
        if (problem) listener(PROBLEMS[problem]);
      });
    },
    resend(clients) {
      const states = provider.awareness.getStates();
      const present = clients.filter((client) => states.has(client));
      if (!present.length || !provider.wsconnected) return;
      provider._awarenessUpdateHandler({ added: [], updated: present, removed: [] }, null);
    },
    send(message) {
      if (!provider.wsconnected || provider.ws?.readyState !== WebSocket.OPEN) return false;
      try {
        provider.sendMessage(message);
        return true;
      } catch {
        return false;
      }
    },
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
  const ticket = (id: string, gc: boolean) =>
    requestCollaborationTicket<RoomTicket>(
      `/spaces/${encodeURIComponent(spaceId)}/apps/${encodeURIComponent(appId)}/rooms/${encodeURIComponent(id)}/collaboration-ticket`,
      gc ? undefined : { gc: false },
    );
  return async (id, { gc, signal }) => {
    const first = await firstCollaborationTicket(() => ticket(id, gc), signal);
    if (signal?.aborted) throw new HostError("cancelled", "The app left the room.");
    const doc = new Y.Doc({ gc });
    return providerRoom(
      createYjsProvider(first, doc, "app-room", () => ticket(id, gc)),
      doc,
    );
  };
}

const MOVED_MESSAGE = "This room was replaced on the server. Open it again to keep working.";

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

const carriedUpdate = (message: Uint8Array): Uint8Array | null => {
  try {
    const decoder = decoding.createDecoder(message);
    const type = decoding.readVarUint(decoder);
    if (type !== syncProtocol.messageYjsSyncStep2 && type !== syncProtocol.messageYjsUpdate)
      return null;
    return decoding.readVarUint8Array(decoder);
  } catch {
    return null;
  }
};

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
  mine: Set<number>;
  foreign: Set<number>;
  clocks: Map<number, number>;
  states: Map<number, string | null>;
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
  const retired = new Map<string, Set<number>>();
  const validRoom = (id: string) => ROOM_ID.test(id) && !DOTS_ONLY.test(id);
  const validFile = (id: string) => FILE_ID.test(id) && !DOTS_ONLY.test(id);
  const roomId = (params: Record<string, unknown>) => {
    const id = params.id;
    const valid =
      typeof id === "string" &&
      (validRoom(id) || (id.startsWith(FILE_ROOM) && validFile(id.slice(FILE_ROOM.length))));
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
  const retire = (id: string, clients: Set<number>) => {
    if (!clients.size) return;
    const kept = retired.get(id) ?? new Set<number>();
    for (const client of clients) kept.add(client);
    for (const client of kept) {
      if (kept.size <= RETIRED_KEPT) break;
      kept.delete(client);
    }
    retired.set(id, kept);
  };
  const encodeEntries = (
    room: HostRoom,
    open: OpenRoom,
    entries: [number, string | null][],
    step: number,
  ) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, entries.length);
    for (const [client, json] of entries) {
      const clock =
        Math.max(open.clocks.get(client) ?? 0, room.awareness.meta.get(client)?.clock ?? 0) + step;
      open.clocks.set(client, clock);
      open.states.set(client, json);
      encoding.writeVarUint(encoder, client);
      encoding.writeVarUint(encoder, clock);
      encoding.writeVarString(encoder, json ?? "null");
    }
    return encoding.toUint8Array(encoder);
  };
  const stamp = (id: string, open: OpenRoom, room: HostRoom, update: Uint8Array) => {
    const decoder = decoding.createDecoder(update);
    const count = decoding.readVarUint(decoder);
    const states = room.awareness.getStates();
    const gone = retired.get(id);
    const entries: [number, string | null][] = [];
    for (let index = 0; index < count; index += 1) {
      const client = decoding.readVarUint(decoder);
      decoding.readVarUint(decoder);
      const json = decoding.readVarString(decoder);
      if (client === room.awareness.clientID || open.foreign.has(client) || gone?.has(client))
        continue;
      const state: unknown = JSON.parse(json);
      if (!open.mine.has(client)) {
        if (states.has(client)) {
          open.foreign.add(client);
          continue;
        }
        if (state === null || open.mine.size >= MAX_APP_CLIENTS) continue;
        open.mine.add(client);
      }
      entries.push([
        client,
        state === null
          ? null
          : JSON.stringify({
              ...(typeof state === "object" && !Array.isArray(state)
                ? (state as Record<string, unknown>)
                : {}),
              [IDENTITY_FIELD]: identity,
            }),
      ]);
    }
    return entries.length ? encodeEntries(room, open, entries, 1) : null;
  };
  const apply = (
    id: string,
    open: OpenRoom,
    room: HostRoom,
    kind: "update" | "awareness",
    update: Uint8Array,
  ) => {
    if (kind === "update") {
      if (open.file && !open.file.admit(update)) return;
      Y.applyUpdate(room.doc, update, FROM_APP);
      return;
    }
    const stamped = stamp(id, open, room, update);
    if (stamped) applyAwarenessUpdate(room.awareness, stamped, FROM_APP);
  };
  const restore = (open: OpenRoom, room: HostRoom) => {
    const entries = [...open.states].filter(
      (entry): entry is [number, string] => entry[1] !== null,
    );
    if (!entries.length) return;
    const states = room.awareness.getStates();
    const present = entries.filter(([client]) => states.has(client)).map(([client]) => client);
    applyAwarenessUpdate(room.awareness, encodeEntries(room, open, entries, 2), FROM_APP);
    if (present.length) room.resend?.(present);
  };
  const take = (kind: "update" | "awareness") => async (params: Record<string, unknown>) => {
    const id = roomId(params);
    const open = opened(params);
    const update = bytes(params.update);
    if (open.room) apply(id, open, open.room, kind, update);
    else open.queued.push({ kind, bytes: update });
  };

  return {
    calls: {
      "room.update": take("update"),
      "room.awareness": take("awareness"),
      "room.sync": async (params: Record<string, unknown>) => {
        const open = opened(params);
        const message = bytes(params.message, "The sync message");
        const room = await withTimeout(
          open.ready.then(async (ready) => {
            await ready.synced;
            return ready;
          }),
          ROOM_STALL_MS,
          "The room hasn't connected yet. Try again in a moment.",
        );
        const carried = open.file ? carriedUpdate(message) : null;
        if (carried && open.file && !open.file.admit(carried)) return { messages: [] };
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
      if (isFile && (typeof fileId !== "string" || !validFile(fileId)))
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
        mine: new Set(),
        foreign: new Set(),
        clocks: new Map(),
        states: new Map(),
      };
      entry.ready.catch(() => undefined);
      rooms.set(id, entry);
      const abort = new AbortController();
      let closed = false;
      const stops: (() => void)[] = [];
      let stall: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      const watch = () => {
        clearTimeout(stall);
        stall = undefined;
        if (stopped) return;
        stall = setTimeout(() => {
          stall = undefined;
          if (!closed)
            emit({
              type: "problem",
              code: "stalled",
              message: "The room hasn't connected yet. Misty keeps trying.",
            });
        }, ROOM_STALL_MS);
      };
      const settled = () => {
        clearTimeout(stall);
        stall = undefined;
      };
      const leave = () => {
        if (closed) return;
        closed = true;
        rooms.delete(id);
        settled();
        for (const stop of stops.splice(0)) stop();
        abort.abort();
        rejectReady(new HostError("cancelled", "The app left the room."));
        retire(id, entry.mine);
        const room = entry.room;
        if (room) {
          const states = room.awareness.getStates();
          const present = [...entry.mine].filter((client) => states.has(client));
          if (present.length) removeAwarenessStates(room.awareness, present, FROM_APP);
        }
        if (entry.file) entry.file.close();
        else room?.close();
      };
      const fail = (error: HostError) => {
        if (closed) return;
        leave();
        end(error);
      };
      const roomLost = (room: HostRoom) => {
        if (closed) return;
        if (room.moved?.()) {
          emit({ type: "problem", code: "reloaded", message: MOVED_MESSAGE });
          fail(new HostError("closed", MOVED_MESSAGE));
          return;
        }
        fail(lostError(room.lost()));
      };
      watch();

      const opening =
        isFile && openFile
          ? openFile(fileId as string, { gc, signal: abort.signal }, emit, fail).then(
              (session) => {
                entry.file = session;
                return session.room;
              },
            )
          : source(id, { gc, signal: abort.signal });

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
            if (closed || origin === FROM_APP) return;
            const theirs = [...added, ...updated, ...removed].filter(
              (client) => !entry.mine.has(client),
            );
            if (!theirs.length) return;
            for (const client of theirs) entry.foreign.add(client);
            emit({ type: "awareness", update: encodeAwarenessUpdate(room.awareness, theirs) });
          };
          room.awareness.on("update", onAwareness);
          stops.push(() => room.awareness.off("update", onAwareness));
          stops.push(
            room.onLost(() => {
              if (closed || !room.lost()) return;
              roomLost(room);
            }),
          );
          if (room.onProblem)
            stops.push(
              room.onProblem((problem) => {
                if (closed) return;
                if (problem.code === PROBLEMS.too_large.code) {
                  stopped = true;
                  settled();
                }
                emit({ type: "problem", ...problem });
              }),
            );
          if (room.onMessage) {
            let size: "saved" | "warning" | "blocked" = "saved";
            stops.push(
              room.onMessage((message) => {
                let said: { type?: unknown; status?: unknown };
                try {
                  said = JSON.parse(message) as typeof said;
                } catch {
                  return;
                }
                if (closed || said.type !== "document_status") return;
                if (said.status === "saved") size = "saved";
                else if (said.status === "blocked") {
                  if (size !== "blocked") emit({ type: "problem", ...SIZE_PROBLEMS.blocked });
                  size = "blocked";
                } else if (said.status === "warning") {
                  if (size === "saved") emit({ type: "problem", ...SIZE_PROBLEMS.warning });
                  size = "warning";
                }
              }),
            );
          }
          for (const { kind, bytes: queued } of entry.queued.splice(0))
            apply(id, entry, room, kind, queued);
          if (room.lost()) {
            roomLost(room);
            return;
          }
          void room.synced.then(() => {
            if (closed) return;
            settled();
            if (syncs)
              emit({
                type: "message",
                message: syncMessageOf((encoder) => syncProtocol.writeSyncStep1(encoder, room.doc)),
              });
            else emit({ type: "sync", update: Y.encodeStateAsUpdate(room.doc) });
            room.doc.on("update", onUpdate);
            stops.push(() => room.doc.off("update", onUpdate));
            if (room.onConnection)
              stops.push(
                room.onConnection((connected) => {
                  if (closed) return;
                  if (!connected) {
                    watch();
                    emit({ type: "connection", connected: false });
                    return;
                  }
                  stopped = false;
                  settled();
                  if (syncs)
                    emit({
                      type: "message",
                      message: syncMessageOf((encoder) =>
                        syncProtocol.writeSyncStep1(encoder, room.doc),
                      ),
                    });
                  restore(entry, room);
                  emit({ type: "connection", connected: true });
                }),
              );
            resolveReady(room);
            entry.file?.started();
            const others = [...room.awareness.getStates().keys()].filter(
              (client) => !entry.mine.has(client),
            );
            for (const client of others) entry.foreign.add(client);
            if (others.length)
              emit({ type: "awareness", update: encodeAwarenessUpdate(room.awareness, others) });
          });
        })
        .catch((error: unknown) => {
          if (closed) return;
          fail(openError(error));
        });
      return leave;
    },
  };
}
