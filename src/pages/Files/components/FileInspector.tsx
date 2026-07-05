import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState, type ReactNode } from "react";
import { explorerListDirectory, explorerPrepareOpenItem, explorerPreviewItem, fileMetadataSnapshot } from "../../../api/misty";
import type { DirectoryListing, DirectorySizeRecord, FileEntry, FileMetadataSnapshot, PreparedOpenItem } from "../../../api/types";
import { errorText } from "../../../shared/format";
import { selectAppearancePreferences, useSettingsStore } from "../../../stores/useSettingsStore";
import { directorySizeRecordForPath } from "../../../stores/useExplorerStore";
import { formatBytes, formatDate } from "../utils/fileFormat";
import { FileIcon } from "./FileBrowserIcons";

interface FileInspectorProps {
  listing: DirectoryListing | null;
  selectedEntry: FileEntry | null;
  selectedCount: number;
  mistyTags: string[];
  mistyComments: string;
  directorySizes: Record<string, DirectorySizeRecord>;
  onCalculateSize: (path: string) => void;
  onOpenEntry: (entry: FileEntry) => void;
  onSaveMetadata: (entry: FileEntry, tags: string[], comments: string) => void;
}

interface LoadedPreview {
  text: string | null;
  url: string;
  mimeType: string;
}

interface PreparedPreviewPath {
  path: string;
  prepared: PreparedOpenItem | null;
}

const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const IMAGE_PREVIEW_LOAD_ATTEMPTS = 5;
const IMAGE_PREVIEW_RETRY_DELAY_MS = 80;
const FILE_METADATA_LOAD_DELAY_MS = 180;

const browserImageMimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
};

const textPreviewExtensions = new Set([
  "txt", "text", "log", "md", "markdown", "toml", "yaml", "yml", "ini", "conf", "cfg",
  "csv", "tsv", "rs", "go", "js", "jsx", "ts", "tsx", "css", "html", "xml", "sh",
  "zsh", "bash", "fish", "py", "rb", "java", "c", "h", "cpp", "hpp", "swift", "kt",
  "sql", "json", "jsonc",
]);

const inspectorStyles = {
  root: "h-full min-w-0 overflow-auto bg-[var(--misty-surface)] px-3 py-3 text-[var(--misty-text-muted)] [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin]",
  previewCard:
    "grid h-[238px] place-items-center overflow-hidden rounded-[7px] border border-[var(--misty-border)] bg-[var(--misty-surface-2)] text-[var(--misty-text-subtle)] shadow-[0_14px_34px_rgba(0,0,0,0.2)]",
  previewMedia: "h-full w-full border-0 object-contain",
  previewText:
    "m-0 h-full w-full overflow-auto whitespace-pre-wrap break-words p-3 text-left font-mono text-[11px] leading-[1.45] text-[var(--misty-text-muted)]",
  previewStatus: "text-sm font-medium text-[var(--misty-text-subtle)]",
  folderPreview: "h-full w-full overflow-y-auto overflow-x-hidden p-3 [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin]",
  folderPreviewList: "grid min-w-0 content-start",
  folderPreviewItem:
    "grid min-h-9 min-w-0 cursor-pointer select-none grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-left text-[var(--misty-text-muted)] outline-none hover:border-[var(--misty-border-soft)] hover:bg-[var(--misty-surface-hover)] focus-visible:border-[var(--misty-border-strong)] focus-visible:bg-[var(--misty-surface-hover)] focus-visible:shadow-[0_0_0_2px_rgba(241,243,244,0.08)]",
  folderPreviewThumb:
    "grid size-7 place-items-center overflow-hidden",
  folderPreviewName:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold leading-tight text-[var(--misty-text-muted)]",
  folderPreviewSize:
    "pl-2 text-right text-xs font-semibold text-[var(--misty-text-subtle)]",
  detailsCard: "grid",
  detailRow: "grid gap-2 px-5 py-3.5",
  detailLabel: "text-[12px] font-[720] uppercase leading-none tracking-normal text-[var(--misty-text-subtle)]",
  detailValue: "min-w-0 [overflow-wrap:anywhere] text-[17px] font-[650] leading-[1.25] text-[var(--misty-text)]",
  editorCard: "grid gap-3 border-b border-[var(--misty-border-soft)] px-5 py-4",
  editorLabel: "grid gap-1.5 text-[12px] font-[720] uppercase leading-none tracking-normal text-[var(--misty-text-subtle)]",
  editorInput: "min-h-9 w-full rounded-[7px] border border-[var(--misty-border)] bg-[var(--misty-surface-2)] px-2.5 py-2 text-sm font-medium normal-case leading-normal text-[var(--misty-text)] outline-none focus:border-[var(--misty-border-strong)] focus:shadow-[0_0_0_2px_rgba(241,243,244,0.08)]",
  editorTextarea: "min-h-[74px] resize-y",
  editorActions: "flex justify-end",
  editorButton: "h-8 rounded-[7px] border border-[var(--misty-border)] bg-[var(--misty-surface-selected)] px-3 text-sm font-semibold text-[var(--misty-text)] hover:bg-[var(--misty-surface-3)] hover:border-[var(--misty-border-strong)] disabled:cursor-default disabled:opacity-45",
  dots: "inline-flex h-5 items-center gap-1",
  dot: "size-1.5 rounded-full bg-[var(--misty-text-muted)] motion-safe:animate-bounce",
} as const;

export function FileInspector(props: FileInspectorProps) {
  const folder = listingEntry(props.listing);
  const displayEntry = props.selectedEntry ?? folder;
  const multiple = props.selectedCount > 1;
  const title = multiple ? "Multiple Items" : displayEntry?.name ?? "No Selection";
  const thumbnailPreviewsEnabled = useSettingsStore((state) =>
    selectAppearancePreferences(state.settings?.document).thumbnailPreviewsEnabled,
  );
  const { preview, previewError, previewLoading } = useFilePreview(
    props.selectedEntry,
    thumbnailPreviewsEnabled,
  );
  const { metadata, metadataError } = useFileMetadata(multiple ? null : displayEntry);
  const folderPreview = useFolderPreview(!multiple ? displayEntry : null, props.listing);
  const displayDirectorySize = displayEntry?.kind === "folder"
    ? directorySizeRecordForPath(props.directorySizes, displayEntry.path)
    : undefined;
  const [tagsDraft, setTagsDraft] = useState(props.mistyTags.join(", "));
  const [commentsDraft, setCommentsDraft] = useState(props.mistyComments);
  const metadataDirty = tagsDraft !== props.mistyTags.join(", ") || commentsDraft !== props.mistyComments;
  const shouldCalculateDirectorySize = Boolean(
    displayEntry
      && !multiple
      && canCalculateFolderSize(displayEntry)
      && (!displayDirectorySize || displayDirectorySize.status === "unknown"),
  );

  useEffect(() => {
    if (!shouldCalculateDirectorySize || !displayEntry) return;
    props.onCalculateSize(displayEntry.path);
  }, [displayEntry?.path, props.onCalculateSize, shouldCalculateDirectorySize]);

  useEffect(() => {
    setTagsDraft(props.mistyTags.join(", "));
    setCommentsDraft(props.mistyComments);
  }, [displayEntry?.path, props.mistyComments, props.mistyTags]);

  return (
    <aside className={inspectorStyles.root}>
      <div className={inspectorStyles.previewCard}>
        {displayEntry?.kind === "folder" && !multiple ? (
          <FolderContentsPreview
            entries={folderPreview.entries}
            error={folderPreview.error}
            loading={folderPreview.loading}
            onOpenEntry={props.onOpenEntry}
          />
        ) : previewLoading ? <span className={inspectorStyles.previewStatus}>Loading preview...</span> : null}
        {preview?.mimeType === "application/pdf" ? (
          <object className={inspectorStyles.previewMedia} data={preview.url} type={preview.mimeType} aria-label={`Preview of ${title}`} />
        ) : preview?.text != null ? (
          <pre className={inspectorStyles.previewText}>{preview.text}</pre>
        ) : preview ? (
          <img className={inspectorStyles.previewMedia} src={preview.url} alt={`Preview of ${title}`} />
        ) : previewError ? (
          <span className={inspectorStyles.previewStatus}>{previewError}</span>
        ) : displayEntry?.kind !== "folder" || multiple ? (
          <span className={inspectorStyles.previewStatus}>No preview available</span>
        ) : null}
      </div>

      <section className={inspectorStyles.detailsCard}>
        {multiple ? (
          <>
            <Detail label="Name" value={title} />
            <Detail label="Selection" value={`${props.selectedCount} items`} />
          </>
        ) : (
          <>
            <Detail label="Name" value={title} />
            <Detail
              label="Size"
              valueNode={sizeDetailValue(displayEntry, displayDirectorySize)}
            />
            <Detail label="Path" value={displayEntry?.path ?? props.listing?.path ?? "-"} />
            <Detail label="Items" value={itemsLabel(displayEntry, props.listing)} />
            <Detail label="Modified" value={formatDate(metadata?.modifiedMs ?? displayEntry?.remoteModified ?? displayEntry?.modifiedMs)} />
            <Detail label="Created" value={formatDate(metadata?.createdMs ?? displayEntry?.createdMs)} />
            <Detail label="Accessed" value={formatDate(metadata?.accessedMs)} />
          </>
        )}
      </section>
      {!multiple && displayEntry && metadataError ? (
        <section className={inspectorStyles.detailsCard} aria-label="Stat metadata">
          <Detail label="Stat" value={metadataError} />
        </section>
      ) : null}
      {!multiple && displayEntry ? (
        <section className={inspectorStyles.editorCard} aria-label="Misty metadata">
          <label className={inspectorStyles.editorLabel}>
            <span>Misty Tags</span>
            <input
              className={inspectorStyles.editorInput}
              value={tagsDraft}
              placeholder="work, draft, invoice"
              onChange={(event) => setTagsDraft(event.target.value)}
            />
          </label>
          <label className={inspectorStyles.editorLabel}>
            <span>Misty Comments</span>
            <textarea
              className={`${inspectorStyles.editorInput} ${inspectorStyles.editorTextarea}`}
              value={commentsDraft}
              placeholder="Notes about this item"
              onChange={(event) => setCommentsDraft(event.target.value)}
            />
          </label>
          <div className={inspectorStyles.editorActions}>
            <button
              className={inspectorStyles.editorButton}
              type="button"
              disabled={!metadataDirty}
              onClick={() => props.onSaveMetadata(displayEntry, parseTagDraft(tagsDraft), commentsDraft)}
            >
              Save Metadata
            </button>
          </div>
        </section>
      ) : null}
    </aside>
  );
}

function parseTagDraft(value: string): string[] {
  const tags: string[] = [];
  for (const part of value.split(",")) {
    const tag = part.trim();
    if (!tag || tags.includes(tag)) continue;
    tags.push(tag);
  }
  return tags;
}

function useFileMetadata(entry: FileEntry | null): {
  metadata: FileMetadataSnapshot | null;
  metadataError: string | null;
} {
  const [metadata, setMetadata] = useState<FileMetadataSnapshot | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setMetadata(null);
    setMetadataError(null);
    if (!entry || entry.location.kind === "remote") return () => undefined;
    const timer = window.setTimeout(() => {
      void fileMetadataSnapshot(entry.path)
        .then((snapshot) => {
          if (active) setMetadata(snapshot);
        })
        .catch((error) => {
          if (active) setMetadataError(errorText(error));
        });
    }, FILE_METADATA_LOAD_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [entry?.id, entry?.modifiedMs, entry?.path, entry?.readonly, entry?.sizeBytes]);

  return { metadata, metadataError };
}

function useFolderPreview(entry: FileEntry | null, listing: DirectoryListing | null): {
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
} {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setEntries([]);
    setError(null);
    if (!entry || entry.kind !== "folder") {
      setLoading(false);
      return () => undefined;
    }
    if (listing?.path === entry.path) {
      setEntries(listing.entries.filter((candidate) => !candidate.isDeleted));
      setLoading(false);
      return () => undefined;
    }
    setLoading(true);
    void explorerListDirectory({ path: entry.path, showHidden: false })
      .then((next) => {
        if (active) setEntries(next.entries.filter((candidate) => !candidate.isDeleted));
      })
      .catch((previewError) => {
        if (active) setError(errorText(previewError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entry?.id, entry?.modifiedMs, entry?.path, entry?.remoteModified, listing?.path, listing?.entries]);

  return { entries, loading, error };
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

    const imageMimeType = previewImageMimeType(entry);
    setPreviewLoading(true);
    if (imageMimeType) {
      void previewPathForEntry(entry)
        .then(async (preparedPath) => {
          try {
            return await loadImagePreview(preparedPath, imageMimeType);
          } catch (directLoadError) {
            const loadedPreview = await loadNativeImagePreview(preparedPath);
            objectUrl = loadedPreview.url;
            if (!loadedPreview.url) throw directLoadError;
            return loadedPreview;
          }
        })
        .then((loadedPreview) => {
          if (active) setPreview(loadedPreview);
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
    }

    void previewPathForEntry(entry)
      .then((preparedPath) => explorerPreviewItem(preparedPath.path))
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

async function previewPathForEntry(entry: FileEntry): Promise<PreparedPreviewPath> {
  if (entry.location.kind !== "remote") return { path: entry.path, prepared: null };
  const prepared = await explorerPrepareOpenItem({
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    remoteModified: entry.remoteModified,
  });
  return { path: prepared.localPath, prepared };
}

function previewSupported(entry: FileEntry): boolean {
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return Boolean(previewImageMimeType(entry)) || extension === "pdf" || textPreviewExtensions.has(extension);
}

function previewImageMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return browserImageMimeTypes[extension] ?? null;
}

async function loadImagePreview(preparedPath: PreparedPreviewPath, mimeType: string): Promise<LoadedPreview> {
  const baseUrl = convertFileSrc(preparedPath.path);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < IMAGE_PREVIEW_LOAD_ATTEMPTS; attempt += 1) {
    const url = attempt === 0 ? baseUrl : cacheBustedUrl(baseUrl, attempt);
    try {
      await waitForImage(url);
      return { text: null, url, mimeType };
    } catch (error) {
      lastError = error;
      if (attempt + 1 < IMAGE_PREVIEW_LOAD_ATTEMPTS) {
        await sleep(IMAGE_PREVIEW_RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }
  const baseMessage = lastError instanceof Error ? lastError.message : "Unable to load image preview.";
  throw new Error(`${baseMessage}${previewDiagnosticSuffix(preparedPath)}`);
}

async function loadNativeImagePreview(preparedPath: PreparedPreviewPath): Promise<LoadedPreview> {
  const payload = await explorerPreviewItem(preparedPath.path);
  const bytes = new Uint8Array(payload.bytes);
  const url = URL.createObjectURL(new Blob([bytes], { type: payload.mimeType }));
  return { text: null, url, mimeType: payload.mimeType };
}

function previewDiagnosticSuffix(preparedPath: PreparedPreviewPath): string {
  const prepared = preparedPath.prepared;
  if (!prepared) return "";
  return ` Cache hit: ${prepared.cacheHit ?? prepared.cached}. Local: ${preparedPath.path}. Source: ${prepared.sourcePath ?? "unknown"}. Cache: ${prepared.cachePath ?? "unknown"}.`;
}

function waitForImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to load image preview."));
    image.src = url;
  });
}

function cacheBustedUrl(url: string, attempt: number): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}mistyPreviewAttempt=${attempt}-${Date.now()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

function Detail(props: { label: string; value?: string; valueNode?: ReactNode }) {
  return (
    <div className={inspectorStyles.detailRow}>
      <span className={inspectorStyles.detailLabel}>{props.label}</span>
      <div className={inspectorStyles.detailValue}>{props.valueNode ?? props.value}</div>
    </div>
  );
}

function FolderContentsPreview(props: {
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  onOpenEntry: (entry: FileEntry) => void;
}) {
  if (props.loading) return <span className={inspectorStyles.previewStatus}>Loading contents...</span>;
  if (props.entries.length === 0) return props.error ? <span className={inspectorStyles.previewStatus}>{props.error}</span> : <span className={inspectorStyles.previewStatus}>Folder is empty</span>;
  return (
    <div className={inspectorStyles.folderPreview} aria-label="Directory contents preview">
      <div className={inspectorStyles.folderPreviewList}>
        {props.entries.map((entry) => (
          <button
            className={inspectorStyles.folderPreviewItem}
            key={entry.id}
            type="button"
            aria-label={entry.kind === "folder" ? `Open folder ${entry.name}` : `Open ${entry.name}`}
            title={entry.name}
            onClick={() => props.onOpenEntry(entry)}
          >
            <div className={inspectorStyles.folderPreviewThumb}>
              <FileIcon entry={entry} size={21} variant="table" />
            </div>
            <span className={inspectorStyles.folderPreviewName} title={entry.name}>{entry.name}</span>
            <span className={inspectorStyles.folderPreviewSize}>
              {entry.kind === "folder" ? "" : formatBytes(entry.sizeBytes)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function sizeDetailValue(
  entry: FileEntry | null,
  directorySize: DirectorySizeRecord | undefined,
): ReactNode {
  if (!entry) return "-";
  if (entry.kind !== "folder") return formatBytes(entry.sizeBytes);
  if (directorySize?.status === "ready") return formatBytes(directorySize.sizeBytes);
  if (directorySize?.status === "calculating") return <DirectorySizeDots />;
  if (!canCalculateFolderSize(entry)) return "-";
  if (directorySize?.status === "failed") return "-";
  return <DirectorySizeDots />;
}

function DirectorySizeDots() {
  return (
    <span className={inspectorStyles.dots} aria-label="Calculating folder size">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={inspectorStyles.dot}
          style={{ animationDelay: `${index * 110}ms` }}
        />
      ))}
    </span>
  );
}

function canCalculateFolderSize(entry: FileEntry): boolean {
  return entry.kind === "folder"
    && entry.location.kind !== "remote_provider"
    && !entry.path.includes("://");
}

function itemsLabel(entry: FileEntry | null, listing: DirectoryListing | null): string {
  if (!entry) return "-";
  if (listing && entry.path === listing.path) {
    return `${listing.totalCount} ${listing.totalCount === 1 ? "item" : "items"}`;
  }
  return entry.kind === "folder" ? "-" : "1 item";
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
    modifiedMs: listing.modifiedMs ?? null,
    createdMs: listing.createdMs ?? null,
    readonly: false,
    hidden: false,
    location: listing.location,
  };
}
