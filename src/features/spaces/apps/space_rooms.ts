import {
  BRIDGE_CALLS,
  BRIDGE_TOPICS,
  FILE_TEXT,
  MistyError,
  bridgeRoomOf,
  createRoomBridge,
  fileRoomOpener,
  openRoomClient,
  type FileRoomClientOptions,
  type Identity,
  type RoomWireOptions,
  type TransportConnection,
} from "@misty/sdk";
import { notify } from "@misty/ui";
import { driveFileStore, liveTextName, type DriveHolds } from "./drive_file_store";
import { roomTransport } from "./room_transport";

export const ROOM_CALLS = [...BRIDGE_CALLS, "room.frame", "room.read", "room.change"] as const;

export const ROOM_TOPICS = [...BRIDGE_TOPICS, "room.frames"] as const;

const MAX_KEY_BYTES = 256;

const encoder = new TextEncoder();

const isControl = (character: string) => {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

const record = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new MistyError("invalid", `${what} is missing.`);
  return value as Record<string, unknown>;
};

const bytes = (value: unknown, what: string): Uint8Array => {
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Uint8Array]") {
    const view = value as Uint8Array;
    return value instanceof Uint8Array
      ? view
      : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (tag === "[object ArrayBuffer]") return new Uint8Array(value as ArrayBuffer);
  throw new MistyError("invalid", `${what} is missing.`);
};

function plainOptions(value: unknown): RoomWireOptions {
  if (value === undefined || value === null) return {};
  const said = record(value, "The room's options");
  if (said.file !== undefined || said.text !== undefined)
    throw new MistyError("invalid", "A file opens as a live document through its own room.");
  return {
    ...(typeof said.history === "boolean" ? { history: said.history } : {}),
    ...(typeof said.gc === "boolean" ? { gc: said.gc } : {}),
  };
}

interface FrameRelay {
  binary(frame: Uint8Array): void;
  text(message: Record<string, unknown>): void;
}

export interface SpaceRoomsOptions {
  identity: Identity;
  agents?: () => readonly { id: string; name: string }[];
  holds: DriveHolds;
}

export function createSpaceRooms(spaceId: string, appId: string, options: SpaceRoomsOptions) {
  const { identity } = options;
  const prefix = `app:${appId}:`;
  const keyed = (key: unknown): string => {
    if (typeof key !== "string" || key === "" || [...key].some(isControl))
      throw new MistyError("invalid", "That isn't a room key.");
    const full = `${prefix}${key}`;
    if (encoder.encode(full).length > MAX_KEY_BYTES)
      throw new MistyError("invalid", "That room key is too long.");
    return full;
  };
  const opening = async (key: string, wire: RoomWireOptions) =>
    openRoomClient({
      transport: await roomTransport(),
      space: spaceId,
      key,
      options: wire,
      identity,
    });
  const fileKey = (opened: FileRoomClientOptions) =>
    opened.key === opened.file && opened.text === FILE_TEXT ? opened.file : keyed(opened.key);

  const bridge = createRoomBridge({
    identity: () => ({
      user_id: identity.user_id,
      id: identity.user_id,
      name: identity.name,
      tone: identity.tone,
    }),
    agents: () => options.agents?.() ?? [],
    source: async (id, { gc, history, key }) =>
      bridgeRoomOf(
        await opening(keyed(key ?? id), {
          ...(gc ? {} : { gc: false }),
          ...(history === undefined ? {} : { history }),
        }),
      ),
    files: fileRoomOpener({
      store: driveFileStore(spaceId, options.holds),
      open: (opened) =>
        opening(fileKey(opened), {
          file: opened.file,
          ...(opened.text === undefined ? {} : { text: opened.text }),
          ...(opened.history === undefined ? {} : { history: opened.history }),
          ...(opened.gc ? {} : { gc: false }),
        }),
      text: liveTextName,
      notice: (message) => notify({ message }),
    }),
  });

  const relays = new Map<string, FrameRelay>();
  const moved = new Map<string, string>();

  const frames = (
    params: Record<string, unknown>,
    emit: (data: unknown) => void,
    end: (error?: unknown) => void,
  ): (() => void) => {
    const key = keyed(params.key);
    const wire = plainOptions(params.options);
    const conn = crypto.randomUUID();
    let link: TransportConnection | null = null;
    let left = false;
    const relay: FrameRelay = {
      binary: (frame) => link?.sendBinary(frame),
      text: (message) => link?.sendText(message),
    };
    void roomTransport().then(
      (transport) => {
        if (left) return;
        const url = moved.get(key);
        moved.delete(key);
        link = transport.open(
          { space: spaceId, key, options: wire, ...(url === undefined ? {} : { url }) },
          {
            opened(said) {
              if (left) return;
              relays.set(conn, relay);
              emit({ type: "opened", conn, opened: said });
            },
            binary(frame) {
              if (!left) emit({ type: "binary", frame });
            },
            text(message) {
              if (left) return;
              if (message.type === "moved" && typeof message.url === "string" && message.url)
                moved.set(key, message.url);
              emit({ type: "text", message });
            },
            closed(code, reason) {
              if (left) return;
              left = true;
              relays.delete(conn);
              emit({ type: "closed", code, reason });
              end();
            },
          },
        );
      },
      (error: unknown) => {
        if (left) return;
        left = true;
        end(error);
      },
    );
    return () => {
      left = true;
      relays.delete(conn);
      link?.close();
    };
  };

  const calls = {
    ...bridge.calls,
    "room.frame": async (params: Record<string, unknown>) => {
      const relay = typeof params.conn === "string" ? relays.get(params.conn) : undefined;
      if (!relay) throw new MistyError("closed", "That room connection is closed.");
      if (params.message !== undefined) {
        const message = record(params.message, "The message");
        if (message.option === "file" || message.type === "open")
          throw new MistyError("invalid", "That isn't a message an app may send.");
        relay.text(message);
        return;
      }
      relay.binary(bytes(params.frame, "The frame"));
    },
    "room.read": async (params: Record<string, unknown>) => {
      const key = keyed(params.key);
      const json = params.as === "json";
      const { request } = await roomTransport();
      const answer = await request.read({ space: spaceId, key, as: json ? "json" : "update" });
      if (answer === null) return null;
      return json ? { json: answer } : { update: answer };
    },
    "room.change": async (params: Record<string, unknown>) => {
      const key = keyed(params.key);
      const update = bytes(params.update, "The update");
      const wire = plainOptions(params.options);
      const { request } = await roomTransport();
      await request.write({
        space: spaceId,
        key,
        update,
        ...(Object.keys(wire).length ? { options: wire } : {}),
      });
    },
  };

  return {
    calls,
    agentsChanged: () => bridge.agentsChanged(),
    subscribe(
      topic: string,
      params: Record<string, unknown>,
      emit: (data: unknown) => void,
      end: (error?: unknown) => void,
    ): () => void {
      if (topic === "room.frames") return frames(params, emit, end);
      return bridge.subscribe(params, emit, end);
    },
  };
}
