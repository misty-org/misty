import { File, Folder } from "lucide-react";
import type { DirectoryListing, FileEntry } from "../../../api/types";
import type { ExplorerViewMode } from "../state/useExplorerStore";
import { formatBytes, formatDate } from "../utils/fileFormat";

interface FileBrowserProps {
  listing: DirectoryListing | null;
  selectedIds: string[];
  loading: boolean;
  error: string | null;
  viewMode: ExplorerViewMode;
  onSelect: (entryId: string) => void;
  onOpen: (entry: FileEntry) => void;
}

export function FileBrowser(props: FileBrowserProps) {
  if (props.error) {
    return <div className="explorer-empty error">{props.error}</div>;
  }
  if (props.loading && !props.listing) {
    return <div className="explorer-empty">Loading directory...</div>;
  }
  if (!props.listing) {
    return <div className="explorer-empty">Choose a location to begin.</div>;
  }

  return (
    <section className="file-browser">
      {props.viewMode === "grid" ? <FileGrid {...props} listing={props.listing} /> : <FileTable {...props} listing={props.listing} />}
      <footer className="file-browser-footer">
        {props.listing.totalCount} items ({props.listing.hiddenCount} hidden)
      </footer>
    </section>
  );
}

function FileTable(props: FileBrowserProps & { listing: DirectoryListing }) {
  return (
    <div className="file-table-wrap">
      <table className="file-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Modified</th>
            <th>Size</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          {props.listing.entries.map((entry) => (
            <tr
              key={entry.id}
              className={props.selectedIds.includes(entry.id) ? "selected" : ""}
              onClick={() => props.onSelect(entry.id)}
              onDoubleClick={() => props.onOpen(entry)}
            >
              <td>
                <FileIcon entry={entry} />
                <span>{entry.name}</span>
              </td>
              <td>{formatDate(entry.modifiedMs)}</td>
              <td>{formatBytes(entry.sizeBytes)}</td>
              <td>{entry.kind === "folder" ? "Folder" : entry.extension || entry.kind}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileGrid(props: FileBrowserProps & { listing: DirectoryListing }) {
  return (
    <div className="file-grid">
      {props.listing.entries.map((entry) => (
        <button
          key={entry.id}
          className={props.selectedIds.includes(entry.id) ? "selected" : ""}
          onClick={() => props.onSelect(entry.id)}
          onDoubleClick={() => props.onOpen(entry)}
        >
          <FileIcon entry={entry} size={28} />
          <span>{entry.name}</span>
        </button>
      ))}
    </div>
  );
}

function FileIcon(props: { entry: FileEntry; size?: number }) {
  const size = props.size ?? 18;
  return props.entry.kind === "folder" ? (
    <Folder size={size} className="folder-icon" />
  ) : (
    <File size={size} className="file-icon" />
  );
}
