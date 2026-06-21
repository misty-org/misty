import { File, Folder, MoreHorizontal, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { explorerPrepareOpenItem, explorerPreviewItem } from "../../../api/misty";
import type { DirectoryListing, FileEntry } from "../../../api/types";
import { errorText } from "../../../shared/format";
import { formatBytes, formatDate } from "../utils/fileFormat";

interface FileInspectorProps {
  listing: DirectoryListing | null;
  selectedEntry: FileEntry | null;
  selectedCount: number;
  onOpen: () => void;
  onMore: (x: number, y: number) => void;
}

interface LoadedPreview {
  url: string;
  mimeType: string;
}

export function FileInspector(props: FileInspectorProps) {
  const folder = listingEntry(props.listing);
  const displayEntry = props.selectedEntry ?? folder;
  const multiple = props.selectedCount > 1;
  const title = multiple ? "Multiple Items" : displayEntry?.name ?? "No Selection";
  const kind = multiple ? "Selection" : kindLabel(displayEntry);
  const { preview, previewError, previewLoading } = useFilePreview(props.selectedEntry);

  return (
    <aside className="file-inspector">
      {preview || previewError || previewLoading ? (
        <div className="inspector-preview-card">
          {previewLoading ? <span>Loading preview...</span> : null}
          {preview?.mimeType === "application/pdf" ? (
            <object data={preview.url} type={preview.mimeType} aria-label={`Preview of ${title}`} />
          ) : preview ? (
            <img src={preview.url} alt={`Preview of ${title}`} />
          ) : null}
          {previewError ? <span>{previewError}</span> : null}
        </div>
      ) : (
        <div className="inspector-icon">
          {displayEntry?.kind === "folder" ? <Folder size={92} className="folder-icon" /> : <File size={92} className="file-icon" />}
        </div>
      )}

      <div className="inspector-hero">
        <strong title={title}>{title}</strong>
        <span>{kind}</span>
      </div>

      <div className="inspector-actions">
        <button type="button" disabled={!props.selectedEntry || multiple} onClick={props.onOpen}>
          <Folder size={18} />
          Open
        </button>
        <button
          type="button"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            props.onMore(bounds.left, bounds.bottom + 4);
          }}
        >
          <MoreHorizontal size={18} />
          More
        </button>
      </div>

      <section className="details-card">
        <h2>Details</h2>
        {props.selectedEntry && !multiple ? (
          <>
            <Detail label="Path" value={props.selectedEntry.path} />
            <Detail label="Modified" value={props.selectedEntry.remoteModified || formatDate(props.selectedEntry.modifiedMs)} />
            <Detail label="Created" value={formatDate(props.selectedEntry.createdMs)} />
            <Detail label="Size" value={props.selectedEntry.kind === "folder" ? "--" : formatBytes(props.selectedEntry.sizeBytes)} />
            <Detail label="Kind" value={kindLabel(props.selectedEntry)} />
          </>
        ) : (
          <>
            <Detail label="Path" value={props.listing?.path ?? "--"} />
            <Detail label="Modified" value="--" />
            <Detail label="Created" value="--" />
            <Detail label="Items" value={props.listing ? String(props.listing.totalCount) : "--"} />
            <Detail label="Available" value="--" />
          </>
        )}
        <div className="inspector-tags">
          <span>Tags</span>
          <button type="button" disabled title="Tag editing is not available yet">
            <Tag size={14} />
            Add Tag
          </button>
        </div>
      </section>
    </aside>
  );
}

function useFilePreview(entry: FileEntry | null): {
  preview: LoadedPreview | null;
  previewError: string | null;
  previewLoading: boolean;
} {
  const [preview, setPreview] = useState<LoadedPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setPreview(null);
    setPreviewError(null);
    if (!entry || !previewSupported(entry)) {
      setPreviewLoading(false);
      return () => undefined;
    }

    setPreviewLoading(true);
    void previewPathForEntry(entry)
      .then((path) => explorerPreviewItem(path))
      .then((payload) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(payload.bytes)], { type: payload.mimeType }));
        setPreview({ url: objectUrl, mimeType: payload.mimeType });
      })
      .catch((error) => {
        if (active) setPreviewError(errorText(error));
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry?.id, entry?.modifiedMs, entry?.path]);

  return { preview, previewError, previewLoading };
}

async function previewPathForEntry(entry: FileEntry): Promise<string> {
  if (entry.location.kind !== "remote") return entry.path;
  const prepared = await explorerPrepareOpenItem({
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    remoteModified: entry.remoteModified,
  });
  return prepared.localPath;
}

function previewSupported(entry: FileEntry): boolean {
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return ["png", "jpg", "jpeg", "gif", "bmp", "webp", "pdf", "tga", "hdr", "pbm", "pgm", "pnm", "ppm"].includes(extension);
}

function kindLabel(entry: FileEntry | null): string {
  if (!entry) return "Folder";
  if (entry.kind === "folder") return "Folder";
  if (entry.kind === "symlink") return "Link";
  const extension = entry.extension.toUpperCase().replace(/^\./, "");
  return extension ? `${extension} File` : entry.kind === "file" ? "File" : "Item";
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
