import { disk, fileUrl } from "@/features/files";
import { checkName, diskItem, type FileItem } from "../model";
import type { FileSourceAdapter } from "./source_types";

const pathOf = (item: FileItem) => (item.source.kind === "disk" ? item.source.entry.path : item.id);

export const diskFolder = {
  list: async (path: string, hidden: boolean) =>
    (await disk.list(path, hidden)).entries.map(diskItem),
  create: async (folder: string, kind: "folder" | "file", name: string) =>
    (kind === "folder"
      ? await disk.createFolder(folder, checkName(name))
      : await disk.createFile(folder, checkName(name))
    ).path,
};

export const diskSource: FileSourceAdapter = {
  kind: "disk",
  local: true,
  canRename: true,
  canTrash: true,
  inTrash: false,
  rename: async (item, name) => (await disk.rename(pathOf(item), checkName(name))).path,
  trash: async (items) => {
    await disk.trash(items.map(pathOf));
    return [];
  },
  reveal: (item) => disk.reveal(pathOf(item)),
  previewUrl: (item) => fileUrl(pathOf(item), item.modifiedMs),
  readHead: (item, limit) => disk.readHead(pathOf(item), limit),
};
