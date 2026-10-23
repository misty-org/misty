import type { DirectoryListing, FileEntry } from "@/native/ipc";
import { formatBytes } from "@/shared/lib/fileFormat";
import type { MouseEvent } from "react";
import { memo, useDeferredValue, useMemo } from "react";
import { compileEntryFilterMatcher, entryMatchesQuery } from "./fileFilters";
import type { FileListColumn, FileListSort } from "./fileListColumns";
import { FileListSkeleton } from "./FileListSkeleton";
import { fileListStyles } from "./fileListStyles";
import { FileListTable } from "./FileListTable";

export interface FileListProps {
  listing: DirectoryListing | null;
  selectedIds: string[];
  loading: boolean;
  error: string | null;
  sort: FileListSort;
  /** Narrows the rows by name, type or a glob or /regex/ pattern. */
  filter: string;
  onSort: (column: FileListColumn) => void;
  onSelect: (entryId: string, event: MouseEvent, visibleEntryIds: string[]) => void;
  onClearSelection: () => void;
  onOpen: (entry: FileEntry) => void;
}

const emptyEntries: FileEntry[] = [];

/** A folder's contents as a sortable list, for choosing files. Nothing here edits them. */
export const FileList = memo(function FileList(props: FileListProps) {
  const filter = useDeferredValue(props.filter).trim();
  const filterMatcher = useMemo(
    () => (filter.startsWith(">") ? null : compileEntryFilterMatcher(filter)),
    [filter],
  );
  const sourceEntries = props.listing?.entries ?? emptyEntries;
  const entries = useMemo(
    () =>
      filterMatcher
        ? sourceEntries.filter((entry) => entryMatchesQuery(entry, filterMatcher))
        : sourceEntries,
    [filterMatcher, sourceEntries],
  );

  if (props.error)
    return (
      <div role="alert" className="p-4 text-cream-muted">
        {props.error}
      </div>
    );
  if (props.loading) return <FileListSkeleton />;
  if (!props.listing) {
    return <div className={fileListStyles.empty}>Choose a location to begin.</div>;
  }

  const displayListing =
    entries === props.listing.entries ? props.listing : { ...props.listing, entries };
  const selected = new Set(props.selectedIds);
  const selectedEntries = props.listing.entries.filter(
    (entry) => selected.has(entry.id) && !entry.isDeleted,
  );
  const selectedBytes = selectedEntries.reduce(
    (sum, entry) => sum + (entry.kind === "folder" ? 0 : (entry.sizeBytes ?? 0)),
    0,
  );
  const total = props.listing.totalCount;
  const items = `${total} ${total === 1 ? "item" : "items"}`;
  const selectionLabel =
    selectedEntries.length > 0
      ? `${selectedEntries.length} selected${selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ""}`
      : filterMatcher
        ? `${entries.length} of ${items}`
        : items;
  return (
    <section
      className={fileListStyles.browser}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClearSelection();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <FileListTable {...props} listing={displayListing} />
      <footer className={fileListStyles.footer}>
        <div className={fileListStyles.footerGroup}>
          <span className={fileListStyles.footerItem}>{selectionLabel}</span>
        </div>
      </footer>
    </section>
  );
});
