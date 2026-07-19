import type { FileEntry } from "../../../api/types";
import { invalidTransferReason, storageIdForPath } from "../drag/operations";
import type { DropAcceptance, ExplorerDragItem, ExplorerDragPayload } from "../drag/types";

export type FileBrowserDragItem = ExplorerDragItem;

export function dragItemsForEntry(
  entry: FileEntry,
  entries: FileEntry[],
  selectedIds: Set<string>,
): ExplorerDragItem[] {
  if (entry.isDeleted) return [];
  const sourceEntries = selectedIds.has(entry.id) && selectedIds.size > 1
    ? entries.filter((candidate) => selectedIds.has(candidate.id) && !candidate.isDeleted)
    : [entry];
  return sourceEntries.map((candidate) => ({
    entryId: candidate.id,
    name: candidate.name,
    path: candidate.path,
    isDirectory: candidate.kind === "folder",
    sizeBytes: candidate.sizeBytes,
    remoteModified: candidate.remoteModified,
    location: candidate.location,
    storageId: storageIdForPath(candidate.path, candidate.location.remoteName),
  }));
}

export function transferDropAcceptance(
  payload: ExplorerDragPayload,
  destination: string,
  options: { writable?: boolean; folder?: boolean } = {},
): DropAcceptance {
  if (options.writable === false) return { valid: false, label: "Not writable", reason: "This destination is read-only.", action: "invalid" };
  if (options.folder === false) return { valid: false, label: "Not a folder", reason: "Files can only be dropped into folders.", action: "invalid" };
  const reason = payload.origin === "internal" ? invalidTransferReason(payload.items, destination) : null;
  return reason
    ? { valid: false, label: "Cannot drop here", reason, action: "invalid" }
    : { valid: true, label: payload.origin === "external" ? "Copy here" : "Move or copy here", action: "transfer" };
}
