import { HostError, type ErrorCode } from "../apps/protocol";
import { acceptsFile, type AppFileRef, type FileHost } from "../apps/space_app_files";
import { mimeFromName } from "./drive_entries";
import {
  driveChild,
  driveEntryById,
  driveNative,
  driveParent,
  drivePath,
  onDriveChanged,
  type DriveEntry,
  type DriveInUse,
} from "./drive_native";

type Call = (params: Record<string, unknown>) => Promise<unknown>;

const MAX_PAGE = 200;

export type AppFileChange =
  { kind: "added" | "changed"; file: AppFileRef } | { kind: "removed"; id: string };

type RefEntry = Pick<DriveEntry, "id" | "name" | "size" | "path" | "mtime_ms"> & {
  in_use?: readonly Pick<DriveInUse, "user_id" | "name" | "editing" | "you">[];
};

export function driveFileRef(entry: RefEntry): AppFileRef {
  return {
    id: entry.id,
    name: entry.name,
    mime: mimeFromName(entry.name),
    size: Number.isFinite(entry.size) ? entry.size : 0,
    folder: driveParent(entry.path),
    updated_at: new Date(Number.isFinite(entry.mtime_ms) ? entry.mtime_ms : 0).toISOString(),
    in_use: (entry.in_use ?? []).map((use) => ({
      user_id: use.user_id ?? "",
      name: use.name,
      editing: use.editing,
      you: use.you === true,
    })),
  };
}

export function appFolderName(appName: string): string {
  const safe = appName
    .replace(/[/\\]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return safe && safe !== "." && safe !== ".." ? safe : "App";
}

const MAX_NAME_BYTES = 255;

const twoDigits = (value: number) => String(value).padStart(2, "0");

export function conflictedCopyName(name: string, at: Date): string {
  const day = `${at.getUTCFullYear()}-${twoDigits(at.getUTCMonth() + 1)}-${twoDigits(at.getUTCDate())}`;
  const stamp = `${day} ${twoDigits(at.getUTCHours())}${twoDigits(at.getUTCMinutes())}`;
  const dot = name.lastIndexOf(".");
  let base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  const suffix = ` (conflicted copy ${stamp})`;
  const encoder = new TextEncoder();
  const size = (text: string) => encoder.encode(text).length;
  while (base && size(base) + size(suffix) + size(extension) > MAX_NAME_BYTES)
    base = Array.from(base).slice(0, -1).join("");
  return `${base}${suffix}${extension}`;
}

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";

const ERROR_PHRASES: Array<[ErrorCode, string[]]> = [
  ["not_found", ["isn't there any more", "is gone", "not found", "no such"]],
  ["permission_denied", ["can't do that in this space", "permission", "not allowed", "forbidden"]],
  [
    "conflict",
    [
      "changed since",
      "was deleted",
      "is taken",
      "already there",
      "has it open",
      "isn't empty",
      "conflict",
    ],
  ],
  ["invalid", ["isn't a", "can't be a name", "can't hold", "too big", "name a path", "invalid"]],
];

export function driveHostError(cause: unknown): HostError {
  if (cause instanceof HostError) return cause;
  const message = messageOf(cause) || "Something went wrong with the Space's drive.";
  const lower = message.toLowerCase();
  const code =
    ERROR_PHRASES.find(([, phrases]) => phrases.some((phrase) => lower.includes(phrase)))?.[0] ??
    "internal";
  return new HostError(code, message);
}

const kindsOf = (accept: unknown) =>
  Array.isArray(accept) ? accept.filter((kind): kind is string => typeof kind === "string") : [];

async function bytesOf(value: unknown): Promise<Uint8Array> {
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new HostError("invalid", "The file's bytes are missing.");
}

export interface DriveFileCalls {
  calls: Record<string, Call>;
  watch(params: unknown, emit: (change: AppFileChange) => void): () => void;
  hold(entry: Pick<DriveEntry, "id" | "path">): Promise<() => void>;
  dispose(): void;
}

type HoldReason = "open" | "room";

export function createDriveFileCalls(
  spaceId: string,
  appName: string,
  appId: string,
  host: Pick<FileHost, "pickFiles" | "saved">,
): DriveFileCalls {
  const appFolder = `/${appFolderName(appName)}`;
  const paths = new Map<string, string>();
  const opened = new Map<string, DriveEntry>();
  const held = new Map<string, { id: string; path: string; editing: boolean }>();
  let disposed = false;
  const holdKey = (id: string, reason: HoldReason) => `${reason}:${id}`;
  const holdFor = async (entry: Pick<DriveEntry, "id" | "path">, reason: HoldReason) => {
    const key = holdKey(entry.id, reason);
    if (held.has(key)) return;
    const hold = { id: entry.id, path: entry.path, editing: reason === "room" };
    held.set(key, hold);
    try {
      await driveNative.open(spaceId, entry.path, hold.editing);
    } catch (cause) {
      if (held.get(key) === hold) held.delete(key);
      throw cause;
    }
    if (disposed || held.get(key) !== hold)
      void driveNative.close(spaceId, entry.path, hold.editing).catch(() => undefined);
  };
  const closeHold = (hold: { id: string; path: string; editing: boolean }) =>
    void driveEntryById(spaceId, hold.id)
      .then(
        (entry) => entry?.path ?? hold.path,
        () => hold.path,
      )
      .then((now) => driveNative.close(spaceId, now, hold.editing))
      .catch(() => undefined);
  const releaseFor = (id: string, reason: HoldReason) => {
    const key = holdKey(id, reason);
    const hold = held.get(key);
    if (!hold) return;
    held.delete(key);
    closeHold(hold);
  };
  const shown = (entry: DriveEntry) => {
    paths.set(entry.id, entry.path);
    return driveFileRef(entry);
  };
  const shownRef = (file: AppFileRef) => {
    if (file.folder) paths.set(file.id, driveChild(file.folder, file.name));
    return file;
  };
  const remember = (entry: DriveEntry) => {
    opened.set(entry.name, entry);
    return entry;
  };

  const entryOf = async (fileId: unknown): Promise<DriveEntry> => {
    if (typeof fileId !== "string" || !fileId)
      throw new HostError("invalid", "The file is missing.");
    let entry: DriveEntry | null;
    try {
      entry = await driveEntryById(spaceId, fileId);
    } catch (cause) {
      throw driveHostError(cause);
    }
    if (!entry) {
      paths.delete(fileId);
      throw new HostError("not_found", "That file isn't in the Space's drive any more.");
    }
    paths.set(entry.id, entry.path);
    return entry;
  };

  const write = async (
    params: Record<string, unknown>,
    options?: { replace?: boolean },
  ): Promise<{ file: AppFileRef; how: "new" | "version" }> => {
    const { name, folder, data } = params;
    if (typeof name !== "string" || !name.trim())
      throw new HostError("invalid", "The file needs a name.");
    const fileName = name.trim();
    if (fileName.includes("/") || fileName.includes("\\"))
      throw new HostError("invalid", "A file's name can't hold a slash.");
    const named = typeof folder === "string" && folder.trim() ? drivePath(folder) : undefined;
    const bytes = await bytesOf(data);
    const base = options?.replace ? opened.get(fileName) : undefined;
    const inPlace =
      base && base.kind === "file" && (!named || named === driveParent(base.path))
        ? base
        : undefined;
    const target = inPlace ? driveParent(inPlace.path) : (named ?? appFolder);
    try {
      if (!inPlace) {
        const entry = await driveNative.write(spaceId, target, fileName, bytes);
        if (options?.replace) opened.set(fileName, remember(entry));
        return { file: shown(entry), how: "new" };
      }
      const version =
        inPlace.version ??
        (await driveEntryById(spaceId, inPlace.id).then(
          (entry) => entry?.version,
          () => undefined,
        )) ??
        0;
      let entry: DriveEntry;
      try {
        entry = await driveNative.write(spaceId, target, fileName, bytes, {
          item_id: inPlace.id,
          version,
        });
      } catch (cause) {
        if (driveHostError(cause).code !== "not_found") throw cause;
        entry = await driveNative.write(spaceId, target, fileName, bytes);
        opened.set(fileName, remember(entry));
        return { file: shown(entry), how: "new" };
      }
      opened.set(fileName, remember(entry));
      return { file: shown(entry), how: "version" };
    } catch (cause) {
      throw driveHostError(cause);
    }
  };

  const calls: Record<string, Call> = {
    "files.list": async ({ folder, accept, limit, cursor }) => {
      const explicit = typeof folder === "string" && folder.trim() !== "";
      const path = explicit ? drivePath(folder as string) : appFolder;
      const kinds = kindsOf(accept);
      try {
        const page = await driveNative.list(spaceId, path, {
          cursor: typeof cursor === "string" && cursor ? cursor : undefined,
          limit: Math.min(typeof limit === "number" && limit > 0 ? limit : 100, MAX_PAGE),
        });
        const files = page.entries
          .filter((entry) => entry.kind === "file")
          .map(shown)
          .filter((file) => acceptsFile(kinds, file.mime, file.name));
        return { files, next_cursor: page.next_cursor ?? undefined };
      } catch (cause) {
        const error = driveHostError(cause);
        if (!explicit && error.code === "not_found") return { files: [] };
        throw error;
      }
    },
    "files.upload": async (params) => (await write(params)).file,
    "files.save": async (params) => {
      const { file, how } = await write(params, { replace: true });
      host.saved(file, how);
      return file;
    },
    "files.pick": async ({ accept, multiple }) => {
      const picked = await host.pickFiles({ accept: kindsOf(accept), multiple: multiple === true });
      if (!picked.length) return [];
      const entries = await Promise.all(
        picked.map((file) =>
          driveEntryById(spaceId, file.id).then(
            (entry) => entry && remember(entry),
            () => null,
          ),
        ),
      );
      return picked.map((file) => {
        const entry = entries.find((candidate) => candidate?.id === file.id);
        return entry ? shown(entry) : shownRef(file);
      });
    },
    "files.download": async ({ file_id: fileId }) => {
      const entry = await entryOf(fileId);
      try {
        const data = await driveNative.read(spaceId, entry.path);
        remember(entry);
        return { file: shown(entry), data };
      } catch (cause) {
        throw driveHostError(cause);
      }
    },
    "files.open": async ({ file_id: fileId, app_id: otherApp }) => {
      const entry = await entryOf(fileId);
      const path = entry.path;
      try {
        if (typeof otherApp === "string" && otherApp && otherApp !== appId)
          return await driveNative.reveal(spaceId, path);
        remember(entry);
        await holdFor(entry, "open");
      } catch (cause) {
        throw driveHostError(cause);
      }
    },
  };

  return {
    calls,
    watch(params, emit) {
      const options = typeof params === "object" && params !== null ? params : {};
      const {
        folder,
        accept,
        default_folder: defaultFolder,
      } = options as {
        folder?: unknown;
        accept?: unknown;
        default_folder?: unknown;
      };
      const only =
        typeof folder === "string" && folder.trim()
          ? drivePath(folder)
          : defaultFolder === true
            ? appFolder
            : undefined;
      const kinds = kindsOf(accept);
      const seen = new Set(paths.keys());
      const last = new Map<string, string>();
      return onDriveChanged((changed) => {
        if (changed.space_id !== spaceId) return;
        const gone = new Set(changed.removed ?? []);
        for (const item of changed.items) if (item.removed || item.trashed) gone.add(item.id);
        for (const id of gone) {
          if (!seen.has(id) && !paths.has(id)) continue;
          last.delete(id);
          seen.delete(id);
          paths.delete(id);
          emit({ kind: "removed", id });
        }
        for (const entry of changed.items) {
          if (gone.has(entry.id) || entry.kind !== "file") continue;
          const inside = !only || driveParent(entry.path) === only;
          const known = seen.has(entry.id) || paths.has(entry.id);
          if (!inside) {
            if (paths.has(entry.id)) paths.set(entry.id, entry.path);
            if (known && only) {
              seen.delete(entry.id);
              emit({ kind: "removed", id: entry.id });
            }
            continue;
          }
          const file = shown(entry);
          if (!acceptsFile(kinds, file.mime, file.name)) continue;
          const look = JSON.stringify(file);
          if (known && last.get(entry.id) === look) continue;
          last.set(entry.id, look);
          seen.add(entry.id);
          emit({ kind: known ? "changed" : "added", file });
        }
      });
    },
    async hold(entry) {
      await holdFor(entry, "room");
      return () => releaseFor(entry.id, "room");
    },
    dispose() {
      disposed = true;
      for (const hold of held.values()) closeHold(hold);
      held.clear();
    },
  };
}
