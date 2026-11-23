import * as Y from "yjs";
import { spaceRequest } from "../api/api";
import { driveFileRef, driveHostError } from "../drive/drive_app_files";
import {
  driveEntryById,
  driveNative,
  driveParent,
  onDriveChanged,
  type DriveEntry,
} from "../drive/drive_native";
import { createYjsProvider } from "../journal/notes/create_yjs_provider";
import { providerRoom, type FileRoomOpener, type HostRoom } from "./app_rooms";
import { HostError } from "./protocol";

export const FILE_META = "misty:file";
export const FILE_TEXT = "text";

const SAVE_AFTER_MS = 1500;

export type FileFormat = "text" | "app";

interface FileTicket {
  ticket: string;
  room: string;
  url: string;
  format: FileFormat;
}

export interface FileRoomSession {
  room: HostRoom;
  started(): void;
  serialized(request: number, data: Uint8Array): Promise<void>;
  serializeFailed(request: number, message: string): void;
  close(): void;
}

export interface FileHolds {
  hold(entry: DriveEntry): Promise<() => void>;
}

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export function fileRoomOpener(spaceId: string, appId: string, holds: FileHolds): FileRoomOpener {
  const ticket = (fileId: string) =>
    spaceRequest<FileTicket>(
      `/spaces/${encodeURIComponent(spaceId)}/drive/items/${encodeURIComponent(fileId)}/collaboration-ticket`,
      { method: "POST", body: JSON.stringify({ app_id: appId }) },
    );

  return async (fileId, { gc }, emit) => {
    let found: DriveEntry | null;
    try {
      found = await driveEntryById(spaceId, fileId);
    } catch (cause) {
      throw driveHostError(cause);
    }
    if (!found || found.kind !== "file")
      throw new HostError("not_found", "That file isn't in the Space's drive any more.");
    let entry: DriveEntry = found;
    const first = await ticket(fileId);
    const format: FileFormat = first.format === "text" ? "text" : "app";
    const release = await holds.hold(entry).catch((cause: unknown) => {
      throw driveHostError(cause);
    });
    const doc = new Y.Doc({ gc });
    const room = providerRoom(
      createYjsProvider(first, doc, "file-room", () => ticket(fileId)),
      doc,
    );
    const meta = doc.getMap<unknown>(FILE_META);
    let writer = false;
    let dirty = false;
    let started = false;
    let closed = false;
    let loading = false;
    let loadPending = false;
    let request = 0;
    const pending = new Map<number, Uint8Array>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stops: (() => void)[] = [];

    const loaded = () => meta.get("loaded") !== undefined;
    const tell = () => {
      if (started && !closed) emit({ type: "file", file: driveFileRef(entry), format, writer });
    };
    const askSerialize = () => {
      timer = undefined;
      if (closed || !started || !writer || format !== "app" || !loaded()) return;
      request += 1;
      pending.set(request, Y.encodeStateVector(doc));
      emit({ type: "serialize", request });
    };
    const soon = () => {
      if (closed || !writer || format !== "app") return;
      clearTimeout(timer);
      timer = setTimeout(askSerialize, SAVE_AFTER_MS);
    };
    const load = async () => {
      if (closed || !started || !writer || loaded() || loading) return;
      loading = true;
      try {
        const data = await driveNative.read(spaceId, entry.path);
        if (closed || !writer || loaded()) return;
        const version = entry.version ?? 0;
        loadPending = true;
        if (format === "text") {
          doc.transact(() => {
            doc.getText(FILE_TEXT).insert(0, new TextDecoder().decode(data));
            meta.set("loaded", version);
          });
        } else {
          request += 1;
          emit({ type: "load", request, version, data });
        }
      } finally {
        loading = false;
      }
    };
    const takeTurn = () => {
      if (!writer || !started) return;
      void load().catch(() => undefined);
      if (dirty) soon();
    };

    let wasLoaded = false;
    const onUpdate = () => {
      if (!loaded()) return;
      if (!wasLoaded) {
        wasLoaded = true;
        if (loadPending && writer)
          room.send?.(
            JSON.stringify({ type: "file_saved", state_vector: base64(Y.encodeStateVector(doc)) }),
          );
        loadPending = false;
        return;
      }
      dirty = true;
      soon();
    };
    doc.on("update", onUpdate);
    stops.push(() => doc.off("update", onUpdate));

    if (room.onMessage)
      stops.push(
        room.onMessage((message) => {
          let said: { type?: unknown; writer?: unknown; dirty?: unknown };
          try {
            said = JSON.parse(message) as typeof said;
          } catch {
            return;
          }
          if (said.type !== "file_writer") return;
          const was = writer;
          writer = said.writer === true;
          dirty = said.dirty === true || dirty;
          if (was !== writer) tell();
          if (!writer) {
            clearTimeout(timer);
            timer = undefined;
            pending.clear();
          }
          takeTurn();
        }),
      );

    stops.push(
      onDriveChanged((changed) => {
        if (changed.space_id !== spaceId) return;
        const next = changed.items.find(
          (item) => item.id === entry.id && !item.removed && !item.trashed,
        );
        if (!next) return;
        entry = next;
        tell();
      }),
    );

    return {
      room,
      started() {
        if (started || closed) return;
        started = true;
        tell();
        takeTurn();
      },
      async serialized(answered, data) {
        const covered = pending.get(answered);
        if (!covered) return;
        pending.delete(answered);
        try {
          const now = (await driveEntryById(spaceId, entry.id)) ?? entry;
          entry = await driveNative.write(spaceId, driveParent(now.path), now.name, data, {
            item_id: now.id,
            version: now.version ?? 0,
          });
        } catch (cause) {
          throw driveHostError(cause);
        }
        room.send?.(JSON.stringify({ type: "file_saved", state_vector: base64(covered) }));
        dirty = pending.size > 0 || timer !== undefined;
        tell();
      },
      serializeFailed(answered) {
        pending.delete(answered);
      },
      close() {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        for (const stop of stops.splice(0)) stop();
        release();
        room.close();
      },
    };
  };
}
