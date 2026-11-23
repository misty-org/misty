import { readFileFromPath } from "@/features/files";
import { mimeFromName } from "./drive_entries";
import { driveEntryById, driveNative, drivePath, type DriveEntry } from "./drive_native";

export type DriveBytes = ArrayBuffer | Uint8Array | Blob;

const bytesOf = async (bytes: DriveBytes): Promise<ArrayBuffer | Uint8Array> =>
  bytes instanceof Blob ? bytes.arrayBuffer() : bytes;

export async function saveToDrive(
  spaceId: string,
  folder: string,
  name: string,
  bytes: DriveBytes,
): Promise<DriveEntry> {
  return driveNative.write(spaceId, drivePath(folder), name, await bytesOf(bytes));
}

export async function saveFileToDrive(
  spaceId: string,
  folder: string,
  path: string,
  name?: string,
): Promise<DriveEntry> {
  const file = await readFileFromPath(path);
  return saveToDrive(spaceId, folder, name?.trim() || file.name, file);
}

export async function driveFileById(spaceId: string, itemId: string): Promise<File> {
  const entry = await driveEntryById(spaceId, itemId);
  if (!entry || entry.kind !== "file") throw new Error("That file isn't in the Space's Files.");
  return driveFileOf(entry);
}

export async function driveFileOf(
  entry: Pick<DriveEntry, "space_id" | "path" | "name">,
): Promise<File> {
  const bytes = await driveNative.read(entry.space_id, entry.path);
  return new File([bytes], entry.name, { type: mimeFromName(entry.name) });
}
