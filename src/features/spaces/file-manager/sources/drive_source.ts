import { driveFileUrl, type Failure } from "@/features/files";
import { driveNative, type DriveEntry } from "../../drive";
import { checkName, driveItem, type FileItem } from "../model";
import { failuresOf, headOf, type FileSourceAdapter } from "./source_types";

const DRIVE_PAGE = 500;

const entryOf = (item: FileItem): DriveEntry | undefined =>
  item.source.kind === "drive" ? item.source.entry : undefined;

export async function listDriveFolder(spaceId: string, folder: string): Promise<DriveEntry[]> {
  const entries: DriveEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await driveNative.list(spaceId, folder, { cursor, limit: DRIVE_PAGE });
    for (const entry of page.entries)
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        entries.push(entry);
      }
    if (!page.next_cursor || page.next_cursor === cursor) return entries;
    cursor = page.next_cursor;
  }
}

export const driveFolder = {
  list: async (spaceId: string, folder: string) =>
    (await listDriveFolder(spaceId, folder)).map(driveItem),
  create: async (spaceId: string, folder: string, kind: "folder" | "file", name: string) => {
    const made =
      kind === "folder"
        ? await driveNative.createFolder(spaceId, folder, checkName(name))
        : await driveNative.write(spaceId, folder, checkName(name), new Uint8Array());
    return `drive:${made.id}`;
  },
};

function bySpace(items: FileItem[]): Map<string, DriveEntry[]> {
  const groups = new Map<string, DriveEntry[]>();
  for (const item of items) {
    const entry = entryOf(item);
    if (entry) groups.set(entry.space_id, [...(groups.get(entry.space_id) ?? []), entry]);
  }
  return groups;
}

export const driveSource: FileSourceAdapter = {
  kind: "drive",
  local: false,
  canRename: true,
  canTrash: true,
  inTrash: false,
  rename: async (item, name, replace) => {
    const entry = entryOf(item);
    if (!entry) throw new Error("This item can't be renamed here.");
    const renamed = await driveNative.rename(entry.space_id, entry.path, checkName(name), replace);
    return `drive:${renamed.id}`;
  },
  trash: async (items) => {
    const failed: Failure[] = [];
    for (const [spaceId, entries] of bySpace(items))
      failed.push(
        ...failuresOf(
          await driveNative.trashMany(
            spaceId,
            entries.map((entry) => entry.path),
          ),
        ),
      );
    return failed;
  },
  reveal: async (item) => {
    const entry = entryOf(item);
    if (entry) await driveNative.reveal(entry.space_id, entry.path);
  },
  previewUrl: (item) => {
    const entry = entryOf(item);
    return entry ? driveFileUrl(entry.space_id, entry.path, item.modifiedMs) : undefined;
  },
  readHead: async (item, limit) => {
    const entry = entryOf(item);
    if (!entry) throw new Error("This item can't be read here.");
    return headOf(await driveNative.read(entry.space_id, entry.path, limit), entry.size, limit);
  },
};
