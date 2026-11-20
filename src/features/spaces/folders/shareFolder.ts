import { driveNative, type DriveEntry } from "../drive/driveNative";
import { folderNative } from "./folderNative";

/** The last part of a path: the folder's name, as it lands in the drive. */
export function folderNameFromPath(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || "Folder"
  );
}

/** Lets the person pick a folder in the system's dialog. Null when they cancel. */
export function pickFolderToCopy(start?: string): Promise<string | null> {
  return folderNative.pick(start);
}

/**
 * Copies `localFolder` into the root of the Space's drive, as a folder of the same name (native keeps the
 * name unique), following its `.gitignore` and `.mistyignore`. From then on it is the Space's: the drive
 * keeps it in sync, and the folder on this computer stays as it was.
 */
export function copyFolderIntoSpace(spaceId: string, localFolder: string): Promise<DriveEntry> {
  return driveNative.copyIn(spaceId, localFolder, "/");
}
