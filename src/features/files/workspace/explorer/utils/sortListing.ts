import type { DirectoryListing, DirectorySizeRecord, FileEntry } from "@/native/contracts";
import type { ExplorerSortState } from "../model/interfaces/store/types";
import type { ExplorerSortColumn } from "../model/types/store/types";
import { entrySizeBytes } from "./entrySize";
export function sortListing(
  listing: DirectoryListing,
  sort: ExplorerSortState,
  directorySizes: Record<string, DirectorySizeRecord> = {},
): DirectoryListing {
  const entries = [...listing.entries].sort((left, right) => {
    const folderBias = Number(right.kind === "folder") - Number(left.kind === "folder");
    if (folderBias !== 0) return folderBias;
    const direction = sort.direction === "asc" ? 1 : -1;
    return compareEntries(left, right, sort.column, directorySizes) * direction;
  });
  return { ...listing, entries };
}

export function compareEntries(
  left: FileEntry,
  right: FileEntry,
  column: ExplorerSortColumn,
  directorySizes: Record<string, DirectorySizeRecord>,
): number {
  if (column === "modified") {
    return (
      compareNullableNumber(left.modifiedMs, right.modifiedMs) ||
      compareText(left.remoteModified, right.remoteModified) ||
      compareText(left.name, right.name)
    );
  }
  if (column === "size") {
    return (
      compareNullableNumber(
        entrySizeBytes(left, directorySizes),
        entrySizeBytes(right, directorySizes),
      ) || compareText(left.name, right.name)
    );
  }
  if (column === "type") {
    return compareText(typeLabel(left), typeLabel(right)) || compareText(left.name, right.name);
  }
  return compareText(left.name, right.name);
}

export function compareNullableNumber(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function compareText(left: string | null, right: string | null): number {
  return (left ?? "").localeCompare(right ?? "", undefined, { numeric: true, sensitivity: "base" });
}

export function typeLabel(entry: FileEntry): string {
  return entry.kind === "folder" ? "Folder" : entry.mimeType || entry.extension || entry.kind;
}
