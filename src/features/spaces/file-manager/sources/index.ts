import type { FileItem } from "../model";
import { agentTrashSource } from "./agent_trash_source";
import { diskSource } from "./disk_source";
import { driveSource } from "./drive_source";
import { driveTrashSource } from "./drive_trash_source";
import { projectSource } from "./project_source";
import type { FileSourceAdapter, SourceKind } from "./source_types";
import { trashSource } from "./trash_source";

const adapters: Record<SourceKind, FileSourceAdapter> = {
  disk: diskSource,
  project: projectSource,
  drive: driveSource,
  trash: trashSource,
  "agent-trash": agentTrashSource,
  "drive-trash": driveTrashSource,
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
export { listAgentTrash } from "./agent_trash_source";
export { listDriveTrash } from "./drive_trash_source";
export { failuresOf, type FileSourceAdapter } from "./source_types";
