import { driveNative, type DriveEntry } from "../drive/drive_native";
import { folderNative } from "./folder_native";

export function folderNameFromPath(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || "Folder"
  );
}

export function pickFolderToCopy(start?: string): Promise<string | null> {
  return folderNative.pick(start);
}

export function copyFolderIntoSpace(spaceId: string, localFolder: string): Promise<DriveEntry> {
  return driveNative.copyIn(spaceId, localFolder, "/");
}
