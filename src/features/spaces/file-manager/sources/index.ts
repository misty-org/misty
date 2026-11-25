import type { FileItem } from "../model";
import { diskSource } from "./disk_source";
import { driveSource } from "./drive_source";
import { projectSource } from "./project_source";
import type { FileSourceAdapter, SourceKind } from "./source_types";
import { trashSource } from "./trash_source";

const adapters: Record<SourceKind, FileSourceAdapter> = {
  disk: diskSource,
  project: projectSource,
  drive: driveSource,
  trash: trashSource,
};

export const sourceOf = (item: FileItem): FileSourceAdapter => adapters[item.source.kind];

export function bySource(items: FileItem[]): [FileSourceAdapter, FileItem[]][] {
  const groups = new Map<FileSourceAdapter, FileItem[]>();
  for (const item of items) {
    const adapter = sourceOf(item);
    groups.set(adapter, [...(groups.get(adapter) ?? []), item]);
  }
  return [...groups];
}

export { diskFolder } from "./disk_source";
export { projectFolder } from "./project_source";
export { driveFolder, listDriveFolder } from "./drive_source";
export { listTrash } from "./trash_source";
export { failuresOf, type FileSourceAdapter } from "./source_types";
