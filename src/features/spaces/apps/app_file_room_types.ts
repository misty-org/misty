import type { DriveEntry } from "../drive/drive_native";
import type { HostRoom } from "./app_rooms";

export type FileFormat = "text" | "app";

export interface FileTicket {
  ticket: string;
  room: string;
  url: string;
  format: FileFormat;
}

export interface FileRoomSession {
  room: HostRoom;
  started(): void;
  admit(update: Uint8Array): boolean;
  serialized(request: number, data: Uint8Array): Promise<void>;
  serializeFailed(request: number, message: string): void;
  close(): void;
}

export interface FileHolds {
  hold(entry: DriveEntry): Promise<() => void>;
}

export interface PendingSave {
  base: number;
  snapshot: Uint8Array;
  vector: Uint8Array;
  edits: number;
  size: number;
  version?: number;
  mtime?: number;
  sha?: string;
}
