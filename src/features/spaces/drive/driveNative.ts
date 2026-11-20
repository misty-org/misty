import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@/shared/platform/nativeInvoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * The Space drive's native side (`src-tauri/features/spaces_drive/`): every Space the person belongs to,
 * mounted on this computer at `~/.misty/mnt/<Space>`, kept in sync by Misty itself. Paths are the
 * drive's own, from its root: `/`, `/Design`, `/Design/Report.pdf`.
 */

/** Where a file in the drive is, as native reports it. */
export type DriveEntryState =
  | "online"
  | "downloaded"
  | "downloading"
  | "uploading"
  | "conflict"
  | "not_synced";

/** Someone who has a file open, on one of their computers: another person, or the person themself. */
export interface DriveInUse {
  /** Whose mark it is, for their avatar's tone. */
  user_id?: string;
  name: string;
  device_name: string;
  editing: boolean;
  /** It is the signed-in person's own, on this computer or another of theirs. */
  you?: boolean;
}

/** A file or folder in a Space's drive, as the renderer and the SDK host see it. */
export interface DriveEntry {
  /** The item's stable id on the server (`drv_…`). */
  id: string;
  space_id: string;
  /** Its path in the drive, from the root: `/Design/Report.pdf`. */
  path: string;
  name: string;
  kind: "file" | "folder";
  size: number;
  mtime_ms: number;
  modified_by_name: string;
  state: DriveEntryState;
  keep_downloaded: boolean;
  in_use: DriveInUse[];
  /** The server's version of it this computer last agreed on: what a save in place is made against. */
  version?: number;
}

/** An item in the Space's trash: a drive entry, with when and by whom it was trashed when native says. */
export type DriveTrashEntry = DriveEntry & {
  trashed_at?: string | null;
  trashed_by_name?: string | null;
};

/** How a Space's drive is doing. */
export type DriveSyncStatus = "idle" | "syncing" | "offline" | "failed";

/** One Space's drive status (`drive_status`, `misty://drive-status`). */
export interface DriveSpaceStatus {
  space_id: string;
  status: DriveSyncStatus;
  /** Why it failed or is offline. */
  message?: string | null;
  /** Changes still to go up and come down. */
  pending_uploads?: number;
  pending_downloads?: number;
}

/** One page of a folder. */
export interface DriveListing {
  entries: DriveEntry[];
  next_cursor?: string | null;
}

/** Server changes that landed in a Space's drive. */
export interface DriveChanged {
  space_id: string;
  /** What changed or was added; an item marked `removed` (or `trashed`) left the drive. */
  items: (DriveEntry & { removed?: boolean; trashed?: boolean })[];
  /** Ids of items that left the drive, when native lists them apart. */
  removed?: string[];
}

export type DriveNoticeKind =
  | "deleted_while_open"
  | "delete_refused_in_use"
  | "save_replaced"
  | "revived";

/** Something about the drive the person should hear. */
export interface DriveNotice {
  kind: DriveNoticeKind;
  space_id: string;
  /** The file's name. */
  name: string;
  /** Who did it: who deleted it, has it open, saved over the person's save, or brought it back. */
  by?: string | null;
  /**
   * The trashed item, for Restore: the deleted file, or for `save_replaced` the trashed copy of the
   * person's save that someone else's replaced.
   */
  item_id?: string | null;
}

export const DRIVE_STATUS_EVENT = "misty://drive-status";
export const DRIVE_CHANGED_EVENT = "misty://drive-changed";
export const DRIVE_NOTICE_EVENT = "misty://drive-notice";

/** A Space to mount, for `drive_sync_spaces`. */
export interface DriveSpace {
  id: string;
  name: string;
}

/**
 * Bytes as native returns them: `drive_read` answers raw bytes (`ipc::Response`), an ArrayBuffer;
 * a view or a list of numbers is taken too, for a runtime that hands them over as JSON.
 */
function arrayBufferOf(value: ArrayBuffer | ArrayBufferView | number[]): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return view.slice().buffer;
  }
  return Uint8Array.from(value).buffer;
}

/** The drive's Tauri commands. Arguments are camelCase here; Tauri hands them to Rust as snake_case. */
export const driveNative = {
  status: () => invoke<DriveSpaceStatus[]>("drive_status"),
  list: (spaceId: string, path: string, options?: { cursor?: string; limit?: number }) =>
    invoke<DriveListing>("drive_list", {
      spaceId,
      path,
      cursor: options?.cursor ?? null,
      limit: options?.limit ?? null,
    }),
  /** The entry at `path`; null when nothing is there (or it is on its way to the trash). */
  entry: (spaceId: string, path: string) =>
    invoke<DriveEntry | null>("drive_entry", { spaceId, path }),
  /** The same, found by the item's stable id. */
  entryById: (spaceId: string, itemId: string) =>
    invoke<DriveEntry | null>("drive_entry", { spaceId, itemId }),
  /** The file's bytes, fetched first when it is online only, as one raw body. */
  read: async (spaceId: string, path: string): Promise<ArrayBuffer> =>
    arrayBufferOf(
      await invoke<ArrayBuffer | ArrayBufferView | number[]>("drive_read", { spaceId, path }),
    ),
  /**
   * Writes a file named `name` into `folder` and answers with what it became. With `replace`, it is a new
   * version of that item, made from the version given (its base): when someone saved it since, native
   * merges the two for text or the last save wins, keeping the replaced content in the trash, so a save
   * is never lost. Without it, a name already taken in the folder is written into that file the same way.
   */
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
    // The bytes go as the raw body, the rest in a header, as `auth_http_start` takes a request.
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
  /** Marks the file in use from here (reading, or editing) until `close`. Opening is never refused. */
  open: (spaceId: string, path: string, editing: boolean) =>
    invoke<unknown>("drive_open", { spaceId, path, editing }).then(() => undefined),
  /** Lets go of an `open`; `editing` must be what it was opened with, or the mark stays. */
  close: (spaceId: string, path: string, editing = false) =>
    invoke<void>("drive_close", { spaceId, path, editing }),
  keepDownloaded: (spaceId: string, path: string, keep: boolean) =>
    invoke<void>("drive_keep_downloaded", { spaceId, path, keep }),
  removeDownload: (spaceId: string, path: string) =>
    invoke<void>("drive_remove_download", { spaceId, path }),
  /** Moves the item to the Space's trash; refused only while someone has it open. */
  trash: (spaceId: string, path: string) => invoke<void>("drive_trash", { spaceId, path }),
  trashList: (spaceId: string) => invoke<DriveTrashEntry[]>("drive_trash_list", { spaceId }),
  restore: (spaceId: string, itemId: string) =>
    invoke<void>("drive_restore", { spaceId, itemId }),
  /** Deletes a trashed item for good (needs `drive.purge`). */
  purge: (spaceId: string, itemId: string) => invoke<void>("drive_purge", { spaceId, itemId }),
  /** Copies a folder on this computer into `folder` of the drive, following its ignore rules. */
  copyIn: (spaceId: string, source: string, folder: string) =>
    invoke<DriveEntry>("drive_copy_in", { spaceId, source, folder }),
  /**
   * Sets how many bytes the drive's content cache may keep on this computer (`null`: no limit), a
   * device setting native code keeps and applies at once. At least 64 MB. Answers the limit set.
   */
  setCacheLimit: (bytes: number | null) =>
    invoke<number | null>("drive_set_cache_limit", { bytes }),
  /** Shows the Space's drive, or `path` inside it, in the system's file manager. */
  reveal: (spaceId: string, path?: string) =>
    invoke<void>("drive_reveal", { spaceId, path: path ?? null }),
  /** Which Spaces this computer mounts, for the signed-in account; an empty list unmounts them all. */
  syncSpaces: (server: string, accountId: string, spaces: DriveSpace[]) =>
    invoke<DriveSpaceStatus[]>("drive_sync_spaces", { server, accountId, spaces }),
  /**
   * A realtime `drive.*` Space event, handed on to the sync core. `createdAt` (RFC 3339) lets native
   * ignore an in-use check replayed from the cursor.
   */
  realtimeEvent: (
    spaceId: string,
    type: string,
    payload: Record<string, unknown>,
    createdAt?: string,
  ) =>
    invoke<void>("drive_realtime_event", { spaceId, type, payload, createdAt: createdAt ?? null }),
};

/**
 * A drive file or folder found by its stable id (`drive_entry` with an item id), wherever it is now;
 * null when it isn't in the drive any more.
 */
export function driveEntryById(spaceId: string, itemId: string): Promise<DriveEntry | null> {
  return driveNative.entryById(spaceId, itemId);
}

/**
 * Hears one of the drive's events. Outside the Misty app (a web preview, a test) it hears nothing.
 * Returns the function that stops hearing it.
 */
export function onDriveEvent<T>(event: string, listener: (payload: T) => void): () => void {
  if (!hasTauriInternals()) return () => {};
  let stopped = false;
  let unlisten: (() => void) | null = null;
  void getCurrentWebview()
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
  return () => {
    stopped = true;
    unlisten?.();
  };
}

export const onDriveStatus = (listener: (status: DriveSpaceStatus | DriveSpaceStatus[]) => void) =>
  onDriveEvent(DRIVE_STATUS_EVENT, listener);
export const onDriveChanged = (listener: (changed: DriveChanged) => void) =>
  onDriveEvent(DRIVE_CHANGED_EVENT, listener);
export const onDriveNotice = (listener: (notice: DriveNotice) => void) =>
  onDriveEvent(DRIVE_NOTICE_EVENT, listener);

/** The drive's paths: `/` is the root; no trailing slash otherwise. */
export function drivePath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return `/${parts.join("/")}`;
}

/** The folder a drive path is in: `/Design` for `/Design/Report.pdf`, `/` for `/Report.pdf`. */
export function driveParent(path: string): string {
  const parts = drivePath(path).split("/").filter(Boolean);
  return `/${parts.slice(0, -1).join("/")}`;
}

/** A path inside a drive folder. */
export function driveChild(folder: string, name: string): string {
  const base = drivePath(folder);
  return base === "/" ? `/${name}` : `${base}/${name}`;
}
