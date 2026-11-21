import type { DirEntry } from "@/features/agents";
import type { AgentTrashItem, FileEntry, FinderTag, TrashedItem } from "@/features/files";
import type { SpaceDrivePlace, SpaceDriveTrashPlace } from "../apps/file-picker/pickerPlaces";
import type { DriveEntry, DriveTrashEntry } from "../drive";

/**
 * Where Files is looking. A folder on the disk (behind the disk grant), a folder of one of the person's
 * projects (all Files reaches when the grant is off), a folder of a Space's drive or its trash, or one of
 * the sidebar's lists: Recent, Starred, a Finder tag, Misty's Trash and Agent trash.
 */
export type FilesPlace =
  | { kind: "disk"; path: string }
  | { kind: "project"; root: string; path: string }
  | SpaceDrivePlace
  | SpaceDriveTrashPlace
  | { kind: "recent" }
  | { kind: "starred" }
  | { kind: "tag"; name: string; color: number }
  | { kind: "trash" }
  | { kind: "agent-trash" };

/** What an item is, by where it lives; each carries the native shape it came from. */
export type FileSource =
  | { kind: "disk"; entry: FileEntry }
  | { kind: "project"; path: string }
  | { kind: "drive"; entry: DriveEntry }
  | { kind: "trash"; item: TrashedItem }
  | { kind: "agent-trash"; item: AgentTrashItem }
  | { kind: "drive-trash"; entry: DriveTrashEntry };

/** One item Files lists, whatever its place. */
export interface FileItem {
  /** A disk or project item's own path; otherwise its source and id. */
  id: string;
  name: string;
  /** It opens into a listing of its own (a folder, never a package or an app). */
  folder: boolean;
  size: number;
  modifiedMs: number;
  hidden: boolean;
  tags: FinderTag[];
  source: FileSource;
}

const separatorOf = (path: string) => (path.includes("\\") && !path.includes("/") ? "\\" : "/");

/** The last name in a path. */
export function nameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed || path;
}

/** The folder a path is in; the path itself at a root (`/`, `C:\`). */
export function parentOf(path: string): string {
  const separator = separatorOf(path);
  const trimmed = path.length > 1 ? path.replace(/[\\/]+$/, "") : path;
  const index = trimmed.lastIndexOf(separator);
  if (index < 0) return trimmed;
  if (index === 0) return separator;
  const parent = trimmed.slice(0, index);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

/** A path inside a folder, with the separator the folder's own path uses. */
export function childOf(folder: string, name: string): string {
  const separator = separatorOf(folder);
  return folder.endsWith(separator) ? `${folder}${name}` : `${folder}${separator}${name}`;
}

/** The folders from `root` down to `path`, both included; just `path` when it isn't inside `root`. */
export function foldersBetween(root: string, path: string): string[] {
  if (path === root) return [root];
  const separator = separatorOf(root);
  const base = root.endsWith(separator) ? root : `${root}${separator}`;
  if (!path.startsWith(base)) return [path];
  const folders = [root];
  let at = root;
  for (const name of path.slice(base.length).split(/[\\/]/).filter(Boolean)) {
    at = childOf(at, name);
    folders.push(at);
  }
  return folders;
}

/** Every folder above `path`, from the top of its disk, then `path`. */
export function foldersAbove(path: string): string[] {
  const chain = [path];
  let at = path;
  for (let step = 0; step < 64; step += 1) {
    const up = parentOf(at);
    if (up === at) break;
    chain.unshift(up);
    at = up;
  }
  return chain;
}

/** The folder a place lists on the disk, for those that are one. */
export function placeFolder(place: FilesPlace): string | undefined {
  return place.kind === "disk" || place.kind === "project" ? place.path : undefined;
}

/** A key naming the place, for effects and resets. */
export function placeKey(place: FilesPlace): string {
  switch (place.kind) {
    case "disk":
      return `disk:${place.path}`;
    case "project":
      return `project:${place.path}`;
    case "space-drive":
      return `drive:${place.spaceId}:${place.path}`;
    case "space-drive-trash":
      return `drive-trash:${place.spaceId}`;
    case "tag":
      return `tag:${place.name}`;
    default:
      return place.kind;
  }
}

export const samePlace = (a: FilesPlace, b: FilesPlace) => placeKey(a) === placeKey(b);

/** The places whose items are folders and files that open into more: the ones Columns can show. */
export const browsable = (place: FilesPlace) =>
  place.kind === "disk" || place.kind === "project" || place.kind === "space-drive";

/** The place a folder item opens into, from the place it is listed in. */
export function placeInside(item: FileItem, from: FilesPlace): FilesPlace | undefined {
  if (!item.folder) return undefined;
  const source = item.source;
  if (source.kind === "disk") return { kind: "disk", path: source.entry.path };
  if (source.kind === "project")
    return { kind: "project", root: from.kind === "project" ? from.root : source.path, path: source.path };
  if (source.kind === "drive")
    return { kind: "space-drive", spaceId: source.entry.space_id, path: source.entry.path };
  return undefined;
}

/** A disk or project item's path on this computer. */
export function localPath(item: FileItem): string | undefined {
  if (item.source.kind === "disk") return item.source.entry.path;
  if (item.source.kind === "project") return item.source.path;
  return undefined;
}

/** Folders first, then names as Finder sorts them. */
export function finderOrder(a: FileItem, b: FileItem): number {
  if (a.folder !== b.folder) return a.folder ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

// ── From the native shapes ──────────────────────────────────────────────────────────────────────

export function diskItem(entry: FileEntry): FileItem {
  return {
    id: entry.path,
    name: entry.name,
    folder: entry.kind === "folder",
    size: entry.size,
    modifiedMs: entry.modifiedMs,
    hidden: entry.hidden,
    tags: entry.tags,
    source: { kind: "disk", entry },
  };
}

export function projectItem(folder: string, entry: DirEntry): FileItem {
  const path = childOf(folder, entry.name);
  return {
    id: path,
    name: entry.name,
    folder: entry.isDir,
    size: entry.size,
    modifiedMs: entry.mtimeMs,
    hidden: entry.name.startsWith("."),
    tags: [],
    source: { kind: "project", path },
  };
}

export function driveItem(entry: DriveEntry): FileItem {
  return {
    id: `drive:${entry.id}`,
    name: entry.name,
    folder: entry.kind === "folder",
    size: entry.size,
    modifiedMs: entry.mtime_ms,
    hidden: entry.name.startsWith("."),
    tags: [],
    source: { kind: "drive", entry },
  };
}

export function driveTrashItem(entry: DriveTrashEntry): FileItem {
  const trashed = entry.trashed_at ? Date.parse(entry.trashed_at) : entry.mtime_ms;
  return {
    id: `drive-trash:${entry.id}`,
    name: entry.name,
    folder: false,
    size: entry.size,
    modifiedMs: Number.isFinite(trashed) ? trashed : entry.mtime_ms,
    hidden: false,
    tags: [],
    source: { kind: "drive-trash", entry },
  };
}

export function trashedItem(item: TrashedItem): FileItem {
  return {
    id: `trash:${item.id}`,
    name: item.name,
    folder: false,
    size: item.size,
    modifiedMs: item.trashedAt,
    hidden: false,
    tags: [],
    source: { kind: "trash", item },
  };
}

export function agentTrashItem(item: AgentTrashItem): FileItem {
  return {
    id: `agent-trash:${item.id}`,
    name: item.name,
    folder: false,
    size: item.size,
    modifiedMs: item.trashedAt,
    hidden: false,
    tags: [],
    source: { kind: "agent-trash", item },
  };
}

/** What the item is, for an icon: a folder or a file. */
export function itemShape(item: FileItem): "folder" | "file" {
  if (item.folder) return "folder";
  const source = item.source;
  if (source.kind === "trash" || source.kind === "agent-trash")
    return source.item.kind === "folder" ? "folder" : "file";
  if (source.kind === "drive-trash") return source.entry.kind === "folder" ? "folder" : "file";
  return "file";
}
