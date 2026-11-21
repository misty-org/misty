import { appFolderName, driveFileRef, driveHostError } from "../../drive/driveAppFiles";
import { driveNative, type DriveEntry } from "../../drive/driveNative";
import { copyIntoDrive } from "../../file-manager/driveCopy";
import type { FileItem } from "../../file-manager/model";
import type { AppFileRef } from "../spaceAppFiles";

export const nameOfPath = (path: string) =>
  path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "file";

/**
 * What an app is handed for the files the person picked in Files. An app only ever sees its Space's drive:
 * a file already there is referenced as it is; one from this computer, or from another Space's drive, is
 * copied into the app's own folder there (`/<App name>/`) first, and the app gets that copy.
 */
export async function appFilesFor(spaceId: string, picked: FileItem[], appName: string): Promise<AppFileRef[]> {
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
        // Another Space's file: its bytes, written into this Space for the app.
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
