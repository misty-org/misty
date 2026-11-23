import type { Failure } from "@/features/files";
import { driveNative, type DriveTrashEntry } from "../../drive";
import { driveTrashItem, type FileItem } from "../model";
import { failuresOf, type FileSourceAdapter } from "./source_types";

function bySpace(items: FileItem[]): Map<string, DriveTrashEntry[]> {
  const groups = new Map<string, DriveTrashEntry[]>();
  for (const item of items)
    if (item.source.kind === "drive-trash") {
      const entry = item.source.entry;
      groups.set(entry.space_id, [...(groups.get(entry.space_id) ?? []), entry]);
    }
  return groups;
}

export const listDriveTrash = async (spaceId: string) =>
  (await driveNative.trashList(spaceId)).map(driveTrashItem);

export const driveTrashSource: FileSourceAdapter = {
  kind: "drive-trash",
  local: false,
  canRename: false,
  canTrash: false,
  inTrash: true,
  restore: async (items) => {
    const failed: Failure[] = [];
    for (const [spaceId, entries] of bySpace(items))
      failed.push(
        ...failuresOf(
          await driveNative.restoreMany(
            spaceId,
            entries.map((entry) => entry.id),
          ),
        ),
      );
    return failed;
  },
  purge: async (items) => {
    const failed: Failure[] = [];
    for (const [spaceId, entries] of bySpace(items))
      failed.push(
        ...failuresOf(
          await driveNative.purgeMany(
            spaceId,
            entries.map((entry) => entry.id),
          ),
        ),
      );
    return failed;
  },
  previewUrl: () => undefined,
};
