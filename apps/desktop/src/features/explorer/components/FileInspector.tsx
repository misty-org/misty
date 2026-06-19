import { File, Folder, MoreHorizontal } from "lucide-react";
import type { DirectoryListing, FileEntry } from "../../../api/types";
import { formatBytes, formatDate } from "../utils/fileFormat";

interface FileInspectorProps {
  listing: DirectoryListing | null;
  selectedEntry: FileEntry | null;
}

export function FileInspector(props: FileInspectorProps) {
  const entry = props.selectedEntry ?? listingEntry(props.listing);
  const title = entry?.name ?? "No Selection";
  const kind = entry?.kind === "folder" ? "Folder" : entry?.kind ?? "Item";

  return (
    <aside className="file-inspector">
      <div className="inspector-hero">
        {entry?.kind === "folder" ? <Folder size={76} className="folder-icon" /> : <File size={76} className="file-icon" />}
        <strong>{title}</strong>
        <span>{kind}</span>
      </div>

      <div className="inspector-actions">
        <button disabled={!entry}>
          <Folder size={18} />
          Open
        </button>
        <button disabled={!entry}>
          <MoreHorizontal size={18} />
          More
        </button>
      </div>

      <section className="details-card">
        <h2>Details</h2>
        <Detail label="Path" value={entry?.path ?? props.listing?.path ?? "--"} />
        <Detail label="Modified" value={formatDate(entry?.modifiedMs ?? null)} />
        <Detail label="Created" value={formatDate(entry?.createdMs ?? null)} />
        <Detail label="Size" value={formatBytes(entry?.sizeBytes ?? null)} />
        <Detail label="Items" value={props.listing ? String(props.listing.totalCount) : "--"} />
      </section>
    </aside>
  );
}

function Detail(props: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function listingEntry(listing: DirectoryListing | null): FileEntry | null {
  if (!listing) return null;
  return {
    id: listing.path,
    name: listing.path.split("/").filter(Boolean).pop() || listing.path,
    path: listing.path,
    extension: "",
    mimeType: null,
    remoteModified: null,
    kind: "folder",
    sizeBytes: null,
    modifiedMs: null,
    createdMs: null,
    readonly: false,
    hidden: false,
    location: listing.location,
  };
}
