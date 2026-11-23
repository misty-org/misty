import { driveNative, type DriveEntry } from "../drive";
import { localPath, type FileItem } from "./model";

export async function copyIntoDrive(
  spaceId: string,
  folder: string,
  items: FileItem[],
): Promise<DriveEntry[]> {
  const made: DriveEntry[] = [];
  for (const item of items) {
    if (item.source.kind === "drive") {
      made.push(item.source.entry);
      continue;
    }
    const path = localPath(item);
    if (path) made.push(await driveNative.copyIn(spaceId, path, folder));
  }
  return made;
}
