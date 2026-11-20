import { HostError, type ErrorCode } from "../apps/protocol";
import { acceptsFile, type AppFileRef, type FileHost } from "../apps/spaceAppFiles";
import { mimeFromName } from "./driveEntries";
import {
  driveChild,
  driveEntryById,
  driveNative,
  driveParent,
  drivePath,
  onDriveChanged,
  type DriveEntry,
} from "./driveNative";

type Call = (params: Record<string, unknown>) => Promise<unknown>;

/** The most entries one `files.list` page reads. */
const MAX_PAGE = 200;

/** A change to the drive, as `files.watch` hands it to an app. */
export type AppFileChange =
  | { kind: "added" | "changed"; file: AppFileRef }
  | { kind: "removed"; id: string };

/** A drive file as an app sees a file: its stable id, and its folder's path in the drive. */
export function driveFileRef(entry: DriveEntry): AppFileRef {
  return {
    id: entry.id,
    name: entry.name,
    mime: mimeFromName(entry.name),
    size: Number.isFinite(entry.size) ? entry.size : 0,
    folder: driveParent(entry.path),
    updated_at: new Date(Number.isFinite(entry.mtime_ms) ? entry.mtime_ms : 0).toISOString(),
  };
}

/** A name for a folder in the drive, from an app's name: no separators, never empty. */
export function appFolderName(appName: string): string {
  const safe = appName
    .replace(/[/\\]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return safe && safe !== "." && safe !== ".." ? safe : "App";
}

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";

/**
 * Native's words (`DriveError` and `ApiError` in `space_drive`) and what each means to an app. Native
 * answers with text only, so the phrases it uses are matched here; the first that fits wins.
 */
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

/** What native said, as the code an app can act on. */
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

/** The SDK's file calls on a Space's drive, and what they hold while the app runs. */
export interface DriveFileCalls {
  calls: Record<string, Call>;
  /** `files.watch`: added, changed and removed files, from this computer's changes and the server's. */
  watch(params: unknown, emit: (change: AppFileChange) => void): () => void;
  /** Lets go of every file the app had open. */
  dispose(): void;
}

/**
 * The SDK's `files.*` calls, answered from the Space's drive (`src/features/spaces/drive`):
 *
 * - `files.list` reads a folder of the drive, so files that aren't downloaded show too; with no `folder` it
 *   lists the app's own folder, `/<App name>/`. Only files are listed, never folders.
 * - `files.save` and `files.upload` write into `/<App name>/` unless `folder` names another place.
 * - `files.pick` asks the person (the host's picker); a file from outside the drive is copied into the app's
 *   folder before the app sees it.
 * - `files.download` fetches the file first if it is online only, then hands over its bytes.
 * - `files.open` marks the file in use by this app, as editing, and holds the mark until the app closes;
 *   asked to open it in another app, it shows the file in the drive instead.
 *
 * `FileRef.id` is the item's stable id and `FileRef.folder` its folder's path in the drive. There is no delete
 * and no lock: a file is marked in use only by opening it.
 */
export function createDriveFileCalls(
  spaceId: string,
  appName: string,
  appId: string,
  host: Pick<FileHost, "pickFiles" | "saved">,
): DriveFileCalls {
  const appFolder = `/${appFolderName(appName)}`;
  /** Where each file this app has been shown is, by id, so calls that name only the id can find it. */
  const paths = new Map<string, string>();
  /**
   * Files the app opened (with `files.open` or `files.download`), by name, at the version it read: a save
   * under that name (and no other folder) is a new version of that file.
   */
  const opened = new Map<string, DriveEntry>();
  /**
   * Files `files.open` marked in use, by id, with the path and the way they were opened: closing must
   * name the same `editing`, or native keeps the mark.
   */
  const held = new Map<string, { path: string; editing: boolean }>();
  /** The app closed: an open that answers after that lets go at once. */
  let disposed = false;
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

  /** The file an id names, as native has it now. */
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

  /**
   * Writes a file into the drive. `how` says what became of it: a new version of the file the app opened,
   * or a new file otherwise. A save into an opened file is made from the version the app read: native
   * merges it with what others saved since (text), or the last save wins, the replaced content kept in the
   * trash. A new file under a name already taken in its folder is written into that file the same way.
   */
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
    // A save of a file the app opened, under its name and in no other folder, replaces it in place.
    const base = options?.replace ? opened.get(fileName) : undefined;
    const inPlace =
      base && base.kind === "file" && (!named || named === driveParent(base.path)) ? base : undefined;
    const target = inPlace ? driveParent(inPlace.path) : (named ?? appFolder);
    try {
      if (!inPlace) {
        const entry = await driveNative.write(spaceId, target, fileName, bytes);
        // The app's own Save: its next Save under this name is a version of what it became.
        if (options?.replace) opened.set(fileName, remember(entry));
        return { file: shown(entry), how: "new" };
      }
      // A file not on the server yet when the app read it has no version: its base is the one it has
      // now.
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
        // The file was deleted for good since the app opened it: this save becomes a file of its own
        // where it was.
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
        // The app's own folder exists once it first saves; until then it simply holds nothing.
        if (!explicit && error.code === "not_found") return { files: [] };
        throw error;
      }
    },
    "files.upload": async (params) => (await write(params)).file,
    // An app's own Save goes into the drive, and the person is told where it went and how.
    "files.save": async (params) => {
      const { file, how } = await write(params, { replace: true });
      host.saved(file, how);
      return file;
    },
    "files.pick": async ({ accept, multiple }) => {
      const picked = await host.pickFiles({ accept: kindsOf(accept), multiple: multiple === true });
      // Read at the version picked, so a save back under its name is a version of what the app opened.
      await Promise.all(
        picked.map((file) =>
          driveEntryById(spaceId, file.id).then(
            (entry) => entry && remember(entry),
            () => undefined,
          ),
        ),
      );
      return picked.map(shownRef);
    },
    "files.download": async ({ file_id: fileId }) => {
      const entry = await entryOf(fileId);
      try {
        const data = await driveNative.read(spaceId, entry.path);
        // Read at this version, so a save back is a version of what the app opened.
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
        // Another app can't be started from here yet: the file shows in the drive instead.
        if (typeof otherApp === "string" && otherApp && otherApp !== appId)
          return await driveNative.reveal(spaceId, path);
        remember(entry);
        if (held.has(entry.id)) return;
        // Marked as editing, which is never refused: others see who has it open, and it can't be
        // deleted while it is.
        await driveNative.open(spaceId, path, true);
        if (disposed) void driveNative.close(spaceId, path, true).catch(() => undefined);
        else held.set(entry.id, { path, editing: true });
      } catch (cause) {
        throw driveHostError(cause);
      }
    },
  };

  return {
    calls,
    watch(params, emit) {
      const options = typeof params === "object" && params !== null ? params : {};
      const { folder, accept } = options as { folder?: unknown; accept?: unknown };
      const only = typeof folder === "string" && folder.trim() ? drivePath(folder) : undefined;
      const kinds = kindsOf(accept);
      const seen = new Set(paths.keys());
      // What each file last looked like to the app: a change it can't see (who has it open, its
      // sync state) is no change to it.
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
            // Moved out of the folder it watches: gone from its point of view.
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
    dispose() {
      disposed = true;
      // Closed where each file is now: it may have been renamed or moved while the app had it open.
      for (const [id, { path, editing }] of held)
        void driveEntryById(spaceId, id)
          .then((entry) => entry?.path ?? path, () => path)
          .then((now) => driveNative.close(spaceId, now, editing))
          .catch(() => undefined);
      held.clear();
    },
  };
}
