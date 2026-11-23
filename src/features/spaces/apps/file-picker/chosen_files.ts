import { appFolderName, driveFileRef, driveHostError } from "../../drive/drive_app_files";
import { driveNative, type DriveEntry } from "../../drive/drive_native";
import { copyIntoDrive } from "../../file-manager/drive_copy";
import type { FileItem } from "../../file-manager/model";
import type { AppFileRef } from "../space_app_files";

export const nameOfPath = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || "file";

export async function appFilesFor(
  spaceId: string,
  picked: FileItem[],
  appName: string,
): Promise<AppFileRef[]> {
  const folder = `/${appFolderName(appName)}`;
  const files: AppFileRef[] = [];
  try {
    for (const item of picked) {
      if (item.folder) continue;
      const source = item.source;
      if (source.kind === "drive" && source.entry.space_id === spaceId) {
        files.push(driveFileRef(source.entry));
        continue;
      }
      let made: DriveEntry[];
      if (source.kind === "drive") {
        const bytes = await driveNative.read(source.entry.space_id, source.entry.path);
        made = [await driveNative.write(spaceId, folder, source.entry.name, bytes)];
      } else made = await copyIntoDrive(spaceId, folder, [item]);
      files.push(...made.map(driveFileRef));
    }
  } catch (cause) {
    throw driveHostError(cause);
  }
  return files;
}
