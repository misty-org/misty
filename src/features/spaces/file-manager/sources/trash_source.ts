import { disk } from "@/features/files";
import { trashedItem, type FileItem } from "../model";
import type { FileSourceAdapter } from "./source_types";

const idsOf = (items: FileItem[]) =>
  items.flatMap((item) => (item.source.kind === "trash" ? [item.source.item.id] : []));

export const listTrash = async () => (await disk.trashed()).map(trashedItem);

export const trashSource: FileSourceAdapter = {
  kind: "trash",
  local: false,
  canRename: false,
  canTrash: false,
  inTrash: true,
  restore: async (items) => (await disk.putBack(idsOf(items))).failed,
  purge: (items) => disk.deleteTrashed(idsOf(items)),
  previewUrl: () => undefined,
};
