import { spaceAttachmentsApi } from "../api/attachments";
import { saveFileToDrive, saveToDrive, type DriveBytes } from "./driveFiles";
import { driveNative, type DriveEntry } from "./driveNative";

/**
 * What agents need of a Space's drive (`spacesGateway` in agents): saves into it, its folders and files
 * by path, and a chat attachment's bytes to save there. Everything here is the drive's own call.
 */
export const driveGateway = {
  saveToDrive: (spaceId: string, folder: string, name: string, bytes: DriveBytes) =>
    saveToDrive(spaceId, folder, name, bytes),
  saveFileToDrive: (spaceId: string, folder: string, path: string, name?: string) =>
    saveFileToDrive(spaceId, folder, path, name),
  driveList: (spaceId: string, folder: string, options?: { cursor?: string; limit?: number }) =>
    driveNative.list(spaceId, folder, options),
  driveEntry: (spaceId: string, path: string) => driveNative.entry(spaceId, path),
  driveRead: (spaceId: string, path: string) => driveNative.read(spaceId, path),
  async driveReplace(
    spaceId: string,
    file: Pick<DriveEntry, "id" | "path" | "name" | "version">,
    bytes: DriveBytes,
  ) {
    const folder = file.path.split("/").slice(0, -1).join("/") || "/";
    const content = bytes instanceof Blob ? await bytes.arrayBuffer() : bytes;
    return driveNative.write(spaceId, folder, file.name, content, {
      item_id: file.id,
      version: file.version ?? 0,
    });
  },
  driveTrash: (spaceId: string, path: string) => driveNative.trash(spaceId, path),
  attachmentContent: spaceAttachmentsApi.attachmentContent,
};
