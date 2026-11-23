import { disk } from "@/features/files";
import { diskItem, type FileItem, type FilesPlace } from "./model";
import {
  diskFolder,
  driveFolder,
  listAgentTrash,
  listDriveTrash,
  listTrash,
  projectFolder,
} from "./sources";

const shown = (items: FileItem[], hidden: boolean) =>
  hidden ? items : items.filter((item) => !item.hidden);

export async function listPlace(place: FilesPlace, hidden: boolean): Promise<FileItem[]> {
  switch (place.kind) {
    case "disk":
      return shown(await diskFolder.list(place.path, hidden), hidden);
    case "project":
      return shown(await projectFolder.list(place.path), hidden);
    case "space-drive":
      return shown(await driveFolder.list(place.spaceId, place.path), hidden);
    case "space-drive-trash":
      return listDriveTrash(place.spaceId);
    case "recent":
      return (await disk.recent()).map(diskItem);
    case "starred":
      return (await disk.starred()).map(diskItem);
    case "tag":
      return (await disk.tagged(place.name)).map(diskItem);
    case "trash":
      return listTrash();
    case "agent-trash":
      return listAgentTrash();
  }
}

export function createIn(
  place: FilesPlace,
  kind: "folder" | "file",
  name: string,
  granted: boolean,
): Promise<string> {
  if (place.kind === "space-drive")
    return driveFolder.create(place.spaceId, place.path, kind, name);
  if (place.kind === "disk" && granted) return diskFolder.create(place.path, kind, name);
  if (place.kind === "project")
    return granted
      ? diskFolder.create(place.path, kind, name)
      : projectFolder.create(place.path, kind, name);
  return Promise.reject(new Error("Nothing can be made here."));
}

export const finderOrdered = (place: FilesPlace) =>
  place.kind === "disk" || place.kind === "project" || place.kind === "space-drive";
