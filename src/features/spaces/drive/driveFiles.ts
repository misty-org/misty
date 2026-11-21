import { readFileFromPath } from "@/features/files";
import { mimeFromName } from "./driveEntries";
import { driveEntryById, driveNative, drivePath, type DriveEntry } from "./driveNative";

/** Bytes to save, in any of the shapes callers hold them. */
export type DriveBytes = ArrayBuffer | Uint8Array | Blob;

const bytesOf = async (bytes: DriveBytes): Promise<ArrayBuffer | Uint8Array> =>
  bytes instanceof Blob ? bytes.arrayBuffer() : bytes;

/**
 * Saves a file named `name` into `folder` of a Space's drive, as a new file there (a name already
 * taken in the folder is written into that file, the way the drive merges a save). It answers with
 * the entry it became.
 */
export async function saveToDrive(
  spaceId: string,
  folder: string,
  name: string,
  bytes: DriveBytes,
): Promise<DriveEntry> {
  return driveNative.write(spaceId, drivePath(folder), name, await bytesOf(bytes));
}

/** The same, for a file on this computer: it is read here, then saved under its own name or `name`. */
export async function saveFileToDrive(
  spaceId: string,
  folder: string,
  path: string,
  name?: string,
): Promise<DriveEntry> {
  const file = await readFileFromPath(path);
  return saveToDrive(spaceId, folder, name?.trim() || file.name, file);
}

/** One of a Space's drive files, found by its stable id and read whole. */
export async function driveFileById(spaceId: string, itemId: string): Promise<File> {
  const entry = await driveEntryById(spaceId, itemId);
  if (!entry || entry.kind !== "file") throw new Error("That file isn't in the Space's Files.");
  return driveFileOf(entry);
}

/** A drive file's bytes as a File that can be read or sent. */
export async function driveFileOf(
  entry: Pick<DriveEntry, "space_id" | "path" | "name">,
): Promise<File> {
  const bytes = await driveNative.read(entry.space_id, entry.path);
  return new File([bytes], entry.name, { type: mimeFromName(entry.name) });
}
