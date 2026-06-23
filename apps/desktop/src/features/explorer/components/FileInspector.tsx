import { Download, File, Folder, MoreHorizontal, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { explorerPrepareOpenItem, explorerPreviewItem } from "../../../api/misty";
import type { DirectoryListing, FileEntry } from "../../../api/types";
import { errorText } from "../../../shared/format";
import { selectAppearancePreferences, useSettingsStore } from "../../settings/useSettingsStore";
import { formatBytes, formatDate } from "../utils/fileFormat";

interface FileInspectorProps {
  listing: DirectoryListing | null;
  selectedEntry: FileEntry | null;
  selectedCount: number;
  tags: string[];
  onOpen: () => void;
  onDownload: () => void;
  onMore: (x: number, y: number) => void;
  onTagsChange: (tags: string[]) => void;
}

interface LoadedPreview {
  text: string | null;
  url: string;
  mimeType: string;
}

const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;

export function FileInspector(props: FileInspectorProps) {
  const folder = listingEntry(props.listing);
  const displayEntry = props.selectedEntry ?? folder;
  const multiple = props.selectedCount > 1;
  const title = multiple ? "Multiple Items" : displayEntry?.name ?? "No Selection";
  const kind = multiple ? "Selection" : kindLabel(displayEntry);
  const thumbnailPreviewsEnabled = useSettingsStore((state) =>
    selectAppearancePreferences(state.settings?.document).thumbnailPreviewsEnabled,
  );
  const { preview, previewError, previewLoading } = useFilePreview(
    props.selectedEntry,
    thumbnailPreviewsEnabled,
  );
  const [tagDraft, setTagDraft] = useState("");
  const canEditTags = Boolean(props.selectedEntry && !multiple);
  const canDownload = Boolean(props.selectedEntry?.location.kind === "remote" && !multiple);
  const addTag = () => {
    const nextTag = tagDraft.trim();
    if (!nextTag || props.tags.includes(nextTag)) {
      setTagDraft("");
      return;
    }
    props.onTagsChange([...props.tags, nextTag]);
    setTagDraft("");
  };
  const removeTag = (tag: string) => {
    props.onTagsChange(props.tags.filter((candidate) => candidate !== tag));
  };

  return (
    <aside className="file-inspector">
      {preview || previewError || previewLoading ? (
        <div className="inspector-preview-card">
          {previewLoading ? <span>Loading preview...</span> : null}
          {preview?.mimeType === "application/pdf" ? (
            <object data={preview.url} type={preview.mimeType} aria-label={`Preview of ${title}`} />
          ) : preview?.text != null ? (
            <pre>{preview.text}</pre>
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
        <button type="button" disabled={!canDownload} onClick={props.onDownload}>
          <Download size={18} />
          Download
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
          {props.tags.length > 0 ? (
            <div className="inspector-tag-list">
              {props.tags.map((tag) => (
                <button key={tag} type="button" disabled={!canEditTags} title={`Remove ${tag}`} onClick={() => removeTag(tag)}>
                  {tag}
                  <span aria-hidden="true">x</span>
                </button>
              ))}
            </div>
          ) : <small>No tags</small>}
          <form
            className="inspector-tag-form"
            onSubmit={(event) => {
              event.preventDefault();
              addTag();
            }}
          >
            <input
              value={tagDraft}
              disabled={!canEditTags}
              placeholder="Add tag"
              onChange={(event) => setTagDraft(event.target.value)}
            />
            <button type="submit" disabled={!canEditTags || !tagDraft.trim()}>
              <Tag size={14} />
              Add
            </button>
          </form>
        </div>
      </section>
    </aside>
  );
}

function useFilePreview(entry: FileEntry | null, enabled = true): {
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
    if (!enabled || !entry || !previewSupported(entry)) {
      setPreviewLoading(false);
      return () => undefined;
    }
    const sizeLimitError = previewSizeLimitError(entry);
    if (sizeLimitError) {
      setPreviewError(sizeLimitError);
      setPreviewLoading(false);
      return () => undefined;
    }

    setPreviewLoading(true);
    void previewPathForEntry(entry)
      .then((path) => explorerPreviewItem(path))
      .then((payload) => {
        if (!active) return;
        const bytes = new Uint8Array(payload.bytes);
        if (previewPayloadIsText(payload.mimeType)) {
          setPreview({
            text: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
            url: "",
            mimeType: payload.mimeType,
          });
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: payload.mimeType }));
        setPreview({ text: null, url: objectUrl, mimeType: payload.mimeType });
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
  }, [enabled, entry?.id, entry?.modifiedMs, entry?.path, entry?.remoteModified, entry?.sizeBytes]);

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
  return [
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "pdf", "psd", "tga", "hdr", "pic", "pbm", "pgm", "pnm", "ppm",
    "txt", "text", "log", "md", "markdown", "toml", "yaml", "yml", "ini", "conf", "cfg",
    "csv", "tsv", "rs", "go", "js", "jsx", "ts", "tsx", "css", "html", "xml", "sh",
    "zsh", "bash", "fish", "py", "rb", "java", "c", "h", "cpp", "hpp", "swift", "kt",
    "sql", "json", "jsonc",
  ].includes(extension);
}

function previewSizeLimitError(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.sizeBytes == null || entry.sizeBytes <= MAX_PREVIEW_BYTES) {
    return null;
  }
  return `Preview is limited to ${MAX_PREVIEW_BYTES / (1024 * 1024)} MB.`;
}

function previewPayloadIsText(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType.startsWith("application/json");
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
