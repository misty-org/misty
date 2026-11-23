import { filesApi } from "@/features/agents";
import { disk } from "@/features/files";
import { driveNative, type DriveEntry } from "../drive";
import type { FileItem } from "./model";

const MAX_COPY_BYTES = 100 * 1024 * 1024;

export async function copyIntoDrive(
  spaceId: string,
  folder: string,
  items: FileItem[],
): Promise<DriveEntry[]> {
  const made: DriveEntry[] = [];
  for (const item of items) {
    const source = item.source;
    if (source.kind === "drive") {
      made.push(source.entry);
      continue;
    }
    const path =
      source.kind === "disk" ? source.entry.path : source.kind === "project" ? source.path : null;
    if (!path) continue;
    if (item.folder) {
      made.push(await driveNative.copyIn(spaceId, path, folder));
      continue;
    }
    if (item.size > MAX_COPY_BYTES)
      throw new Error(`${item.name} is too big to copy into the Space from here.`);
    const bytes =
      source.kind === "disk" ? await disk.readBytes(path) : await filesApi.readBytes(path);
    made.push(await driveNative.write(spaceId, folder, item.name, bytes));
  }
  return made;
}
