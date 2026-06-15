import type { DirectorySizeRecord, FileEntry } from "@/native/contracts";
import type { ReactNode } from "react";
import type { PassiveRenameDraft } from "../../model/types/components/FileBrowserInline";
import type { ExplorerInlineEditState } from "../../store";
import { directorySizeRecordForPath } from "../../utils/entrySize";
import { formatBytes } from "../../utils/fileFormat";
import { fileBrowserStyles } from "../FileBrowserStyles";

/** Folder sizes are computed lazily, so they animate while the walk is running. */
export function formatEntrySize(
  entry: FileEntry,
  directorySizes: Record<string, DirectorySizeRecord>,
): ReactNode {
  if (entry.kind !== "folder") return formatBytes(entry.sizeBytes);
  const record = directorySizeRecordForPath(directorySizes, entry.path);
  if (record?.status === "calculating") return <DirectorySizeDots />;
  if (record?.status === "ready") return formatBytes(record.sizeBytes);
  return formatBytes(null);
}

export function DirectorySizeDots() {
  return (
    <span className={fileBrowserStyles.directorySizeDots} aria-label="Calculating folder size">
      {[0, 1, 2].map((index) => (
        <span
          className={fileBrowserStyles.directorySizeDot}
          style={{ animationDelay: `${index * 120}ms` }}
          aria-hidden="true"
          key={index}
        />
      ))}
    </span>
  );
}

/**
 * The other rows taking part in a batch rename, keyed by entry.
 *
 * Only one row holds the live editor; the rest show a read-only preview of the
 * name they will get, so this excludes the focused entry and other panes.
 */
export function passiveRenameDraftsFor(
  edit: ExplorerInlineEditState | null,
  paneId: string,
): Map<string, PassiveRenameDraft> {
  const drafts = new Map<string, PassiveRenameDraft>();
  if (edit?.kind !== "rename" || !edit.batchItems || edit.batchItems.length <= 1) return drafts;
  for (const item of edit.batchItems) {
    if (item.paneId !== paneId || (item.paneId === edit.paneId && item.entryId === edit.entryId))
      continue;
    drafts.set(item.entryId, {
      value: item.value,
      lockedExtension: item.lockedExtension,
      error: item.error,
    });
  }
  return drafts;
}

/** Resolves selected ids to live entries, skipping anything already deleted. */
export function selectedEntriesForListing(
  entries: FileEntry[],
  selectedIds: string[],
): FileEntry[] {
  if (selectedIds.length === 0) return [];
  if (selectedIds.length === 1) {
    const entry = entries.find(
      (candidate) => candidate.id === selectedIds[0] && !candidate.isDeleted,
    );
    return entry ? [entry] : [];
  }
  const selected = new Set(selectedIds);
  return entries.filter((entry) => selected.has(entry.id) && !entry.isDeleted);
}
