import { tabSwitchScope } from "@misty/ui";
import { readFileFromPath } from "@/features/files";
import { draggedFilesScope, holdDraggedFiles } from "@/shared/platform/dragged_files";
import { driveFileOf } from "../drive/drive_files";
import { localPath, parentOf, type FileItem, type FilesPlace } from "./model";
import { sourceOf } from "./sources";

let held: FileItem[] = [];

export async function readItem(item: FileItem): Promise<File> {
  const path = localPath(item);
  if (path) return readFileFromPath(path);
  if (item.source.kind === "drive") return driveFileOf(item.source.entry);
  throw new Error(`${item.name} can't be read here.`);
}

export function carryFiles(items: FileItem[]): Record<string, string> {
  held = items;
  const carries: Record<string, string> = { [tabSwitchScope]: "" };
  const files = items.filter(
    (item) =>
      !item.folder &&
      !sourceOf(item).inTrash &&
      (localPath(item) !== undefined || item.source.kind === "drive"),
  );
  if (files.length)
    carries[draggedFilesScope] = holdDraggedFiles(
      files.map((item) => ({ name: item.name, read: () => readItem(item) })),
    );
  return carries;
}

export function draggedItems(
  ids: ReadonlyArray<string>,
  shown: ReadonlyMap<string, FileItem>,
): FileItem[] {
  return ids.flatMap((id) => held.find((item) => item.id === id) ?? shown.get(id) ?? []);
}

export function takesDrop(place: FilesPlace): boolean {
  return place.kind === "disk" || place.kind === "project" || place.kind === "space-drive";
}

function inside(item: FileItem, place: FilesPlace): boolean {
  if (place.kind === "space-drive")
    return (
      item.source.kind === "drive" &&
      item.source.entry.space_id === place.spaceId &&
      parentOf(item.source.entry.path) === place.path
    );
  const path = localPath(item);
  return (
    (place.kind === "disk" || place.kind === "project") &&
    path !== undefined &&
    parentOf(path) === place.path
  );
}

export function canDropIn(place: FilesPlace, items: FileItem[], copy: boolean): boolean {
  if (!takesDrop(place) || !items.length) return false;
  return copy || !items.every((item) => inside(item, place));
}
