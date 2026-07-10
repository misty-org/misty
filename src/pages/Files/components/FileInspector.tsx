import { Archive, FileText, Folder, Maximize2, Minus, Music, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { archiveList, explorerGenerateImageThumbnail, explorerListDirectory, explorerPrepareOpenItem, explorerPreviewItem, fileMetadataSnapshot } from "../../../api/misty";
import type { ArchiveEntry, DirectoryListing, DirectorySizeRecord, FileEntry, FileMetadataSnapshot, PreparedOpenItem } from "../../../api/types";
import { errorText } from "../../../shared/format";
import { safeTauriAssetUrl } from "../../../shared/tauri";
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
  onOpenEntry: (entry: FileEntry) => void;
  onSaveMetadata: (entry: FileEntry, tags: string[], comments: string) => void;
}

interface LoadedPreview {
  kind: "image" | "video" | "audio" | "pdf" | "text" | "archive";
  text: string | null;
  url: string;
  mimeType: string;
  archiveEntries?: ArchiveEntry[];
  archiveFormat?: string;
  archiveTotalCount?: number;
}

interface PreparedPreviewPath {
  path: string;
  prepared: PreparedOpenItem | null;
}

const FOLDER_PREVIEW_LIMIT = 80;
const FILE_METADATA_LOAD_DELAY_MS = 180;
const FILE_PREVIEW_LOAD_DELAY_MS = 0;
const INSPECTOR_IMAGE_PREVIEW_MAX_DIMENSION = 384;

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

const browserVideoMimeTypes: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
};

const browserAudioMimeTypes: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  weba: "audio/webm",
  aif: "audio/aiff",
  aiff: "audio/aiff",
};

const archivePreviewExtensions = new Set([
  "zip",
  "tar",
  "tgz",
  "tar.gz",
  "tbz",
  "tbz2",
  "tar.bz2",
  "txz",
  "tar.xz",
  "7z",
  "rar",
]);

const nativeImageThumbnailExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "tga",
  "hdr",
  "pic",
  "pbm",
  "pgm",
  "pnm",
  "ppm",
  "psd",
]);

const textPreviewExtensions = new Set([
  "txt", "text", "log", "md", "markdown", "toml", "yaml", "yml", "ini", "conf", "cfg",
  "csv", "tsv", "rs", "go", "js", "jsx", "ts", "tsx", "css", "html", "xml", "sh",
  "zsh", "bash", "fish", "py", "rb", "java", "c", "h", "cpp", "hpp", "swift", "kt",
  "sql", "json", "jsonc",
]);

const inspectorStyles = {
  root: "h-full min-w-0 overflow-auto bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] px-3 py-3 text-[var(--misty-text-muted)] [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin]",
  previewCard:
    "relative isolate grid h-[238px] place-items-center overflow-hidden rounded-[7px] border border-transparent bg-transparent text-[var(--misty-text-subtle)] shadow-[0_14px_34px_rgba(0,0,0,0.2)]",
  previewMedia: "h-full w-full border-0 object-contain",
  audioPreview:
    "grid h-full w-full content-center justify-items-center gap-3 px-4 text-[var(--misty-text-muted)]",
  audioIcon:
    "grid size-14 place-items-center rounded-full border border-[var(--misty-neutral-border,var(--misty-border-soft))] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))]",
  audioControl: "w-full max-w-[260px]",
  previewOpenButton:
    "absolute right-2 top-2 z-[3] grid size-8 place-items-center rounded-[7px] border border-transparent bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] text-[var(--misty-text-muted)] opacity-0 shadow-[0_10px_24px_rgba(0,0,0,0.25)] transition hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[var(--misty-text)] focus-visible:opacity-100 group-hover:opacity-100",
  previewLoadingOverlay:
    "pointer-events-none absolute inset-0 z-[2] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] opacity-55 motion-safe:animate-pulse",
  previewText:
    "m-0 h-full w-full overflow-auto whitespace-pre-wrap break-words p-3 text-left font-mono text-[11px] leading-[1.45] text-[var(--misty-text-muted)]",
  previewStatus: "text-sm font-medium text-[var(--misty-text-subtle)]",
  folderPreview: "h-full w-full overflow-y-auto overflow-x-hidden p-3 [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin]",
  folderPreviewList: "grid min-w-0 content-start",
  folderPreviewItem:
    "grid min-h-9 min-w-0 cursor-pointer select-none grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-left text-[var(--misty-text-muted)] outline-none hover:border-[var(--misty-neutral-border,var(--misty-border-soft))] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] focus-visible:border-[var(--misty-border-strong)] focus-visible:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] focus-visible:shadow-[0_0_0_2px_rgba(241,243,244,0.08)]",
  folderPreviewThumb:
    "grid size-7 place-items-center overflow-hidden",
  folderPreviewName:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold leading-tight text-[var(--misty-text-muted)]",
  folderPreviewSize:
    "pl-2 text-right text-xs font-semibold text-[var(--misty-text-subtle)]",
  archivePreviewSummary:
    "mb-2 flex min-w-0 items-center justify-between gap-2 px-2 text-xs font-semibold uppercase tracking-normal text-[var(--misty-text-subtle)]",
  detailsCard: "grid",
  detailRow: "grid gap-2 px-5 py-3.5",
  detailLabel: "text-[12px] font-[720] uppercase leading-none tracking-normal text-[var(--misty-text-subtle)]",
  detailValue: "min-w-0 [overflow-wrap:anywhere] text-[17px] font-[650] leading-[1.25] text-[var(--misty-text)]",
  editorCard: "grid gap-3 border-b border-transparent px-5 py-4",
  editorLabel: "grid gap-1.5 text-[12px] font-[720] uppercase leading-none tracking-normal text-[var(--misty-text-subtle)]",
  editorInput: "min-h-9 w-full rounded-[7px] border border-[var(--misty-border)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] px-2.5 py-2 text-sm font-medium normal-case leading-normal text-[var(--misty-text)] outline-none focus:border-[var(--misty-border-strong)] focus:shadow-[0_0_0_2px_rgba(241,243,244,0.08)]",
  editorTextarea: "min-h-[74px] resize-y",
  editorActions: "flex justify-end",
  editorButton: "h-8 rounded-[7px] border border-[var(--misty-border)] bg-[var(--misty-neutral-selected-bg,var(--misty-surface-selected))] px-3 text-sm font-semibold text-[var(--misty-text)] hover:bg-[var(--misty-neutral-strong-bg,var(--misty-surface-3))] hover:border-[var(--misty-border-strong)] disabled:cursor-default disabled:opacity-45",
  dots: "inline-flex h-5 items-center gap-1",
  dot: "size-1.5 rounded-full bg-[var(--misty-text-muted)] motion-safe:animate-bounce",
  lightboxBackdrop:
    "fixed inset-0 z-[2147483200] grid place-items-center bg-[rgba(0,0,0,0.64)] p-6 backdrop-blur-[3px]",
  lightbox:
    "relative grid h-[min(82vh,860px)] w-[min(88vw,1280px)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[10px] border border-white/10 bg-[rgba(10,12,15,0.88)] shadow-[0_28px_90px_rgba(0,0,0,0.62)]",
  lightboxHeader:
    "flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-[var(--misty-text)]",
  lightboxTitle: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold",
  lightboxControls: "flex shrink-0 items-center gap-1.5",
  lightboxButton:
    "grid size-8 place-items-center rounded-[7px] border border-white/10 bg-white/5 text-[var(--misty-text-muted)] transition hover:bg-white/12 hover:text-[var(--misty-text)]",
  zoomSurface: "relative h-full min-h-0 overflow-hidden bg-black/20",
  zoomImage:
    "absolute left-1/2 top-1/2 max-h-full max-w-full select-none object-contain will-change-transform",
} as const;

export function FileInspector(props: FileInspectorProps) {
  const displayEntry = props.selectedEntry;
  const multiple = props.selectedCount > 1;
  const title = multiple ? "Multiple Items" : displayEntry?.name ?? "No Selection";
  const { preview, previewError, previewLoading } = useFilePreview(
    props.selectedEntry,
  );
  const { metadata, metadataError } = useFileMetadata(multiple ? null : displayEntry);
  const folderPreview = useFolderPreview(!multiple ? displayEntry : null, props.listing);
  const displayDirectorySize = displayEntry?.kind === "folder"
    ? directorySizeRecordForPath(props.directorySizes, displayEntry.path)
    : undefined;
  const [tagsDraft, setTagsDraft] = useState(props.mistyTags.join(", "));
  const [commentsDraft, setCommentsDraft] = useState(props.mistyComments);
  const [previewOpen, setPreviewOpen] = useState(false);
  const metadataDirty = tagsDraft !== props.mistyTags.join(", ") || commentsDraft !== props.mistyComments;
  useEffect(() => {
    setTagsDraft(props.mistyTags.join(", "));
    setCommentsDraft(props.mistyComments);
  }, [displayEntry?.path, props.mistyComments, props.mistyTags]);
  const showPreviewTransition = previewLoading && displayEntry?.kind !== "folder" && !multiple;
  const canOpenPreview = Boolean(preview && (preview.kind === "image" || preview.kind === "video"));

  return (
    <aside className={inspectorStyles.root}>
      <div className={`${inspectorStyles.previewCard} group`} aria-busy={showPreviewTransition || undefined}>
        {displayEntry?.kind === "folder" && !multiple ? (
          <FolderContentsPreview
            entries={folderPreview.entries}
            error={folderPreview.error}
            loading={folderPreview.loading}
            onOpenEntry={props.onOpenEntry}
          />
        ) : null}
        {preview?.kind === "archive" ? (
          <ArchiveContentsPreview preview={preview} />
        ) : preview?.kind === "pdf" ? (
          <object className={inspectorStyles.previewMedia} data={preview.url} type={preview.mimeType} aria-label={`Preview of ${title}`} />
        ) : preview?.text != null ? (
          <pre className={inspectorStyles.previewText}>{preview.text}</pre>
        ) : preview?.kind === "video" ? (
          <video className={inspectorStyles.previewMedia} src={preview.url} controls autoPlay muted playsInline preload="metadata" />
        ) : preview?.kind === "audio" ? (
          <AudioPreview preview={preview} title={title} />
        ) : preview ? (
          <PreviewImage className={inspectorStyles.previewMedia} src={preview.url} alt={`Preview of ${title}`} />
        ) : previewError ? (
          <span className={inspectorStyles.previewStatus}>{previewError}</span>
        ) : !showPreviewTransition && (displayEntry?.kind !== "folder" || multiple) ? (
          <span className={inspectorStyles.previewStatus}>No preview available</span>
        ) : null}
        {canOpenPreview ? (
          <button
            className={inspectorStyles.previewOpenButton}
            type="button"
            aria-label={`Open preview of ${title}`}
            onClick={() => setPreviewOpen(true)}
          >
            <Maximize2 size={16} />
          </button>
        ) : null}
        {showPreviewTransition ? <span className={inspectorStyles.previewLoadingOverlay} aria-hidden="true" /> : null}
      </div>
      {previewOpen && preview && canOpenPreview ? (
        <MediaPreviewLightbox preview={preview} title={title} onClose={() => setPreviewOpen(false)} />
      ) : null}

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
            <Detail label="Path" value={displayEntry?.path ?? "-"} />
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

function PreviewImage(props: { className: string; src: string; alt: string }) {
  return (
    <img
      className={props.className}
      src={props.src}
      alt={props.alt}
      draggable={false}
      loading="lazy"
      decoding="async"
    />
  );
}

function MediaPreviewLightbox(props: { preview: LoadedPreview; title: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [props.preview.url]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  const zoomBy = (delta: number) => {
    setScale((current) => clampZoom(current + delta));
  };
  const resetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div className={inspectorStyles.lightboxBackdrop} role="presentation" onPointerDown={props.onClose}>
      <section
        className={inspectorStyles.lightbox}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${props.title}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className={inspectorStyles.lightboxHeader}>
          <span className={inspectorStyles.lightboxTitle}>{props.title}</span>
          <div className={inspectorStyles.lightboxControls}>
            {props.preview.kind === "image" ? (
              <>
                <button className={inspectorStyles.lightboxButton} type="button" aria-label="Zoom out" onClick={() => zoomBy(-0.25)}>
                  <Minus size={16} />
                </button>
                <button className={inspectorStyles.lightboxButton} type="button" aria-label="Reset zoom" onClick={resetZoom}>
                  <RotateCcw size={16} />
                </button>
                <button className={inspectorStyles.lightboxButton} type="button" aria-label="Zoom in" onClick={() => zoomBy(0.25)}>
                  <Plus size={16} />
                </button>
              </>
            ) : null}
            <button className={inspectorStyles.lightboxButton} type="button" aria-label="Close preview" onClick={props.onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        {props.preview.kind === "video" ? (
          <video className="h-full min-h-0 w-full bg-black object-contain" src={props.preview.url} controls autoPlay muted playsInline />
        ) : (
          <div
            className={inspectorStyles.zoomSurface}
            onWheel={(event) => {
              event.preventDefault();
              zoomBy(event.deltaY > 0 ? -0.15 : 0.15);
            }}
            onPointerDown={(event) => {
              if (scale <= 1) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                originX: offset.x,
                originY: offset.y,
              };
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              setOffset({
                x: drag.originX + event.clientX - drag.startX,
                y: drag.originY + event.clientY - drag.startY,
              });
            }}
            onPointerUp={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
            }}
            onPointerCancel={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
            }}
          >
            <img
              className={inspectorStyles.zoomImage}
              src={props.preview.url}
              alt={`Preview of ${props.title}`}
              draggable={false}
              loading="lazy"
              decoding="async"
              style={{
                cursor: scale > 1 ? "grab" : "default",
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function clampZoom(value: number): number {
  return Math.min(8, Math.max(0.25, Number(value.toFixed(2))));
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
      setEntries(folderPreviewEntries(listing.entries));
      setLoading(false);
      return () => undefined;
    }
    setLoading(true);
    void explorerListDirectory({ path: entry.path, showHidden: false })
      .then((next) => {
        if (active) setEntries(folderPreviewEntries(next.entries));
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

function folderPreviewEntries(entries: FileEntry[]): FileEntry[] {
  return entries.filter((candidate) => !candidate.isDeleted).slice(0, FOLDER_PREVIEW_LIMIT);
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
    const imageMimeType = previewImageMimeType(entry);
    const videoMimeType = previewVideoMimeType(entry);
    const audioMimeType = previewAudioMimeType(entry);
    setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      if (!active) return;
      if (videoMimeType) {
        void loadDirectMediaPreview(entry, "video", videoMimeType)
          .then((loadedPreview) => {
            if (active) setPreview(loadedPreview);
          })
          .catch((error) => {
            if (active) setPreviewError(previewErrorTextForDisplay(error));
          })
          .finally(() => {
            if (active) setPreviewLoading(false);
          });
        return;
      }
      if (audioMimeType) {
        void loadDirectMediaPreview(entry, "audio", audioMimeType)
          .then((loadedPreview) => {
            if (active) setPreview(loadedPreview);
          })
          .catch((error) => {
            if (active) setPreviewError(previewErrorTextForDisplay(error));
          })
          .finally(() => {
            if (active) setPreviewLoading(false);
          });
        return;
      }
      if (archivePreviewSupported(entry)) {
        void loadArchivePreview(entry)
          .then((loadedPreview) => {
            if (active) setPreview(loadedPreview);
          })
          .catch((error) => {
            if (active) setPreviewError(previewErrorTextForDisplay(error));
          })
          .finally(() => {
            if (active) setPreviewLoading(false);
          });
        return;
      }
      if (nativeImageThumbnailSupported(entry)) {
        void loadNativeImagePreview(entry)
          .then((loadedPreview) => {
            if (active) setPreview(loadedPreview);
          })
          .catch((error) => {
            if (active) setPreviewError(previewErrorTextForDisplay(error));
          })
          .finally(() => {
            if (active) setPreviewLoading(false);
          });
        return;
      }
      void previewPathForEntry(entry)
        .then((preparedPath) => explorerPreviewItem(preparedPath.path))
        .then((payload) => {
          if (!active) return;
          const bytes = new Uint8Array(payload.bytes);
          if (previewPayloadIsText(payload.mimeType)) {
            setPreview({
              kind: "text",
              text: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
              url: "",
              mimeType: payload.mimeType,
            });
            return;
          }
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: payload.mimeType }));
          setPreview({
            kind: payload.mimeType === "application/pdf" ? "pdf" : "image",
            text: null,
            url: objectUrl,
            mimeType: payload.mimeType,
          });
        })
        .catch((error) => {
          if (active) setPreviewError(previewErrorTextForDisplay(error));
        })
        .finally(() => {
          if (active) setPreviewLoading(false);
        });
    }, FILE_PREVIEW_LOAD_DELAY_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
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
  return Boolean(previewImageMimeType(entry))
    || Boolean(previewVideoMimeType(entry))
    || Boolean(previewAudioMimeType(entry))
    || nativeImageThumbnailSupported(entry)
    || archivePreviewSupported(entry)
    || extension === "pdf"
    || textPreviewExtensions.has(extension);
}

function previewImageMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return browserImageMimeTypes[extension] ?? null;
}

async function loadNativeImagePreview(entry: FileEntry): Promise<LoadedPreview> {
  const payload = await explorerGenerateImageThumbnail(entry.path, INSPECTOR_IMAGE_PREVIEW_MAX_DIMENSION, {
    modifiedMs: entry.modifiedMs,
    remoteModified: entry.remoteModified,
    sizeBytes: entry.sizeBytes,
  });
  const url = safeTauriAssetUrl(payload.path);
  return { kind: "image", text: null, url, mimeType: payload.mimeType };
}

function previewVideoMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return browserVideoMimeTypes[extension] ?? null;
}

function previewAudioMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return browserAudioMimeTypes[extension] ?? null;
}

function archivePreviewSupported(entry: FileEntry): boolean {
  if (entry.kind === "folder" || entry.kind === "symlink") return false;
  return archivePreviewExtensions.has(normalizedArchiveExtension(entry));
}

function normalizedArchiveExtension(entry: FileEntry): string {
  const name = entry.name.toLowerCase();
  for (const compoundExtension of ["tar.gz", "tar.bz2", "tar.xz"]) {
    if (name.endsWith(`.${compoundExtension}`)) return compoundExtension;
  }
  return entry.extension.toLowerCase().replace(/^\./, "");
}

async function loadDirectMediaPreview(
  entry: FileEntry,
  kind: "image" | "video" | "audio",
  mimeType: string,
): Promise<LoadedPreview> {
  const preparedPath = await previewPathForEntry(entry);
  return {
    kind,
    text: null,
    url: safeTauriAssetUrl(preparedPath.path),
    mimeType,
  };
}

async function loadArchivePreview(entry: FileEntry): Promise<LoadedPreview> {
  const preparedPath = await previewPathForEntry(entry);
  const result = await archiveList({ path: preparedPath.path });
  return {
    kind: "archive",
    text: null,
    url: "",
    mimeType: "application/vnd.misty.archive-list",
    archiveEntries: result.entries.slice(0, FOLDER_PREVIEW_LIMIT),
    archiveFormat: result.format,
    archiveTotalCount: result.entries.length,
  };
}

function previewErrorTextForDisplay(error: unknown): string | null {
  const message = errorText(error);
  if (message.toLowerCase().includes("too large to thumbnail")) return null;
  return message;
}

function nativeImageThumbnailSupported(entry: FileEntry): boolean {
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return nativeImageThumbnailExtensions.has(extension);
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

function AudioPreview(props: { preview: LoadedPreview; title: string }) {
  return (
    <div className={inspectorStyles.audioPreview} aria-label={`Audio preview of ${props.title}`}>
      <div className={inspectorStyles.audioIcon} aria-hidden="true">
        <Music size={28} />
      </div>
      <audio className={inspectorStyles.audioControl} src={props.preview.url} controls preload="metadata" />
    </div>
  );
}

function ArchiveContentsPreview(props: { preview: LoadedPreview }) {
  const entries = props.preview.archiveEntries ?? [];
  const totalCount = props.preview.archiveTotalCount ?? entries.length;
  if (totalCount === 0) return <span className={inspectorStyles.previewStatus}>Archive is empty</span>;
  return (
    <div className={inspectorStyles.folderPreview} aria-label="Archive contents preview">
      <div className={inspectorStyles.archivePreviewSummary}>
        <span>{props.preview.archiveFormat ?? "archive"}</span>
        <span>{totalCount} {totalCount === 1 ? "item" : "items"}</span>
      </div>
      <div className={inspectorStyles.folderPreviewList}>
        {entries.map((entry, index) => {
          const name = archiveEntryName(entry.path);
          return (
            <div
              className={inspectorStyles.folderPreviewItem}
              key={`${entry.path}-${index}`}
              title={entry.path}
            >
              <div className={inspectorStyles.folderPreviewThumb}>
                {entry.isDir ? <Folder size={20} /> : archiveEntryIsArchive(entry.path) ? <Archive size={20} /> : <FileText size={20} />}
              </div>
              <span className={inspectorStyles.folderPreviewName} title={entry.path}>{name}</span>
              <span className={inspectorStyles.folderPreviewSize}>
                {entry.isDir ? "" : formatArchiveEntrySize(entry)}
              </span>
            </div>
          );
        })}
      </div>
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

function archiveEntryName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").filter(Boolean).pop() ?? path;
}

function archiveEntryIsArchive(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return [...archivePreviewExtensions].some((extension) => lowerPath.endsWith(`.${extension}`));
}

function formatArchiveEntrySize(entry: ArchiveEntry): string {
  const size = entry.uncompressedSize || entry.compressedSize;
  return size > 0 ? formatBytes(size) : "";
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
  return "-";
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
