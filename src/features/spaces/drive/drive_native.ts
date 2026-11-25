import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@/shared/platform/native_invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

export type DriveEntryState =
  "online" | "downloaded" | "downloading" | "uploading" | "conflict" | "not_synced";

export interface DriveInUse {
  user_id?: string;
  name: string;
  device_name: string;
  editing: boolean;
  you?: boolean;
}

export interface DriveEntry {
  id: string;
  space_id: string;
  path: string;
  name: string;
  kind: "file" | "folder";
  size: number;
  mtime_ms: number;
  modified_by_name: string;
  state: DriveEntryState;
  keep_downloaded: boolean;
  in_use: DriveInUse[];
  version?: number;
  content_version?: number;
  sha?: string;
  waits_large?: boolean;
}

export type DriveSyncStatus = "idle" | "syncing" | "offline" | "failed";

export interface DriveSpaceStatus {
  space_id: string;
  status: DriveSyncStatus;
  message?: string | null;
  pending_uploads?: number;
  pending_downloads?: number;
}

export interface DriveListing {
  entries: DriveEntry[];
  next_cursor?: string | null;
}

export interface DriveChanged {
  space_id: string;
  items: (DriveEntry & { removed?: boolean; trashed?: boolean })[];
  removed?: string[];
}

export type DriveNoticeKind =
  "deleted_while_open" | "delete_refused_in_use" | "save_replaced" | "revived" | "deletes_held";

export interface DriveNotice {
  kind: DriveNoticeKind;
  space_id: string;
  name: string;
  by?: string | null;
  item_id?: string | null;
  count?: number | null;
  burst?: string | null;
}

export const DRIVE_STATUS_EVENT = "misty://drive-status";
export const DRIVE_CHANGED_EVENT = "misty://drive-changed";
export const DRIVE_NOTICE_EVENT = "misty://drive-notice";

export interface DriveFailure {
  path: string;
  error: string;
}

export interface DriveSpace {
  id: string;
  name: string;
}

function arrayBufferOf(value: ArrayBuffer | ArrayBufferView | number[]): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return view.slice().buffer;
  }
  return Uint8Array.from(value).buffer;
}

export const driveNative = {
  status: () => invoke<DriveSpaceStatus[]>("drive_status"),
  conflicts: () => invoke<DriveEntry[]>("drive_conflicts"),
  list: (spaceId: string, path: string, options?: { cursor?: string; limit?: number }) =>
    invoke<DriveListing>("drive_list", {
      spaceId,
      path,
      cursor: options?.cursor ?? null,
      limit: options?.limit ?? null,
    }),
  entry: (spaceId: string, path: string) =>
    invoke<DriveEntry | null>("drive_entry", { spaceId, path }),
  entryById: (spaceId: string, itemId: string) =>
    invoke<DriveEntry | null>("drive_entry", { spaceId, itemId }),
  read: async (spaceId: string, path: string, limit?: number): Promise<ArrayBuffer> =>
    arrayBufferOf(
      await invoke<ArrayBuffer | ArrayBufferView | number[]>("drive_read", {
        spaceId,
        path,
        limit: limit ?? null,
      }),
    ),
  write: (
    spaceId: string,
    folder: string,
    name: string,
    bytes: ArrayBuffer | Uint8Array,
    replace?: { item_id: string; version: number },
  ): Promise<DriveEntry> => {
    if (!hasTauriInternals()) {
      return Promise.reject(
        new Error('Native command "drive_write" is only available in the Misty app runtime.'),
      );
    }
    return tauriInvoke<DriveEntry>(
      "drive_write",
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
      {
        headers: {
          "X-Misty-Request": encodeURIComponent(
            JSON.stringify({ spaceId, folder, name, replace: replace ?? null }),
          ),
        },
      },
    );
  },
  open: (spaceId: string, path: string, editing: boolean) =>
    invoke<unknown>("drive_open", { spaceId, path, editing }).then(() => undefined),
  close: (spaceId: string, path: string, editing = false) =>
    invoke<void>("drive_close", { spaceId, path, editing }),
  keepDownloaded: (spaceId: string, path: string, keep: boolean) =>
    invoke<void>("drive_keep_downloaded", { spaceId, path, keep }),
  removeDownload: (spaceId: string, path: string) =>
    invoke<void>("drive_remove_download", { spaceId, path }),
  trash: (spaceId: string, path: string) => invoke<void>("drive_trash", { spaceId, path }),
  trashMany: (spaceId: string, paths: string[]) =>
    invoke<DriveFailure[]>("drive_trash_many", { spaceId, paths }),
  restoreMany: (spaceId: string, itemIds: string[]) =>
    invoke<DriveFailure[]>("drive_restore_many", { spaceId, itemIds }),
  purgeMany: (spaceId: string, itemIds: string[]) =>
    invoke<DriveFailure[]>("drive_purge_many", { spaceId, itemIds }),
  restore: (spaceId: string, itemId: string) => invoke<void>("drive_restore", { spaceId, itemId }),
  restoreBurst: (spaceId: string, burst: string) =>
    invoke<number>("drive_restore_burst", { spaceId, burst }),
  purge: (spaceId: string, itemId: string) => invoke<void>("drive_purge", { spaceId, itemId }),
  createFolder: (spaceId: string, folder: string, name: string) =>
    invoke<DriveEntry>("drive_create_folder", { spaceId, folder, name }),
  rename: (spaceId: string, path: string, name: string, replace?: boolean) =>
    invoke<DriveEntry>("drive_rename", { spaceId, path, name, replace: replace ?? null }),
  move: (spaceId: string, paths: string[], folder: string, replace?: boolean) =>
    invoke<DriveEntry[]>("drive_move", { spaceId, paths, folder, replace: replace ?? null }),
  copyIn: (spaceId: string, source: string, folder: string) =>
    invoke<DriveEntry>("drive_copy_in", { spaceId, source, folder }),
  setCacheLimit: (bytes: number | null) =>
    invoke<number | null>("drive_set_cache_limit", { bytes }),
  setLargeFileLimit: (bytes: number | null) =>
    invoke<number | null>("drive_set_large_file_limit", { bytes }),
  syncLarge: (spaceId: string, path: string) =>
    invoke<DriveEntry>("drive_sync_large", { spaceId, path }),
  setPaused: (paused: boolean) => invoke<boolean>("drive_set_paused", { paused }),
  paused: () => invoke<boolean>("drive_paused"),
  reveal: (spaceId: string, path?: string) =>
    invoke<void>("drive_reveal", { spaceId, path: path ?? null }),
  syncSpaces: (server: string, accountId: string, spaces: DriveSpace[]) =>
    invoke<DriveSpaceStatus[]>("drive_sync_spaces", { server, accountId, spaces }),
  realtimeEvent: (
    spaceId: string,
    type: string,
    payload: Record<string, unknown>,
    createdAt?: string,
  ) =>
    invoke<void>("drive_realtime_event", { spaceId, type, payload, createdAt: createdAt ?? null }),
};

export function driveEntryById(spaceId: string, itemId: string): Promise<DriveEntry | null> {
  return driveNative.entryById(spaceId, itemId);
}

export interface DriveSubscription {
  ready: Promise<void>;
  stop: () => void;
}

export function subscribeDriveEvent<T>(
  event: string,
  listener: (payload: T) => void,
): DriveSubscription {
  if (!hasTauriInternals()) return { ready: Promise.resolve(), stop: () => {} };
  let stopped = false;
  let unlisten: (() => void) | null = null;
  const ready = getCurrentWebview()
    .listen<T>(event, ({ payload }) => {
      if (!stopped) listener(payload);
    })
    .then(
      (stop) => {
        if (stopped) stop();
        else unlisten = stop;
      },
      () => undefined,
    );
  return {
    ready,
    stop: () => {
      stopped = true;
      unlisten?.();
    },
  };
}

export function onDriveEvent<T>(event: string, listener: (payload: T) => void): () => void {
  return subscribeDriveEvent(event, listener).stop;
}

export const subscribeDriveChanged = (listener: (changed: DriveChanged) => void) =>
  subscribeDriveEvent(DRIVE_CHANGED_EVENT, listener);

export const onDriveStatus = (listener: (status: DriveSpaceStatus | DriveSpaceStatus[]) => void) =>
  onDriveEvent(DRIVE_STATUS_EVENT, listener);
export const onDriveChanged = (listener: (changed: DriveChanged) => void) =>
  onDriveEvent(DRIVE_CHANGED_EVENT, listener);
export const onDriveNotice = (listener: (notice: DriveNotice) => void) =>
  onDriveEvent(DRIVE_NOTICE_EVENT, listener);

export function drivePath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return `/${parts.join("/")}`;
}

export function driveParent(path: string): string {
  const parts = drivePath(path).split("/").filter(Boolean);
  return `/${parts.slice(0, -1).join("/")}`;
}

export function driveChild(folder: string, name: string): string {
  const base = drivePath(folder);
  return base === "/" ? `/${name}` : `${base}/${name}`;
}
