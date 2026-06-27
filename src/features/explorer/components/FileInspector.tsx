import { convertFileSrc } from "@tauri-apps/api/core";
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
const IMAGE_PREVIEW_LOAD_ATTEMPTS = 5;
const IMAGE_PREVIEW_RETRY_DELAY_MS = 80;

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
  root: "h-full min-w-0 overflow-auto bg-[#151515] px-3.5 py-[18px]",
  previewCard:
    "grid h-[180px] place-items-center overflow-hidden rounded-[7px] bg-[#1d1d1d] text-[#949494]",
  previewMedia: "h-full w-full border-0 object-contain",
  previewText:
    "m-0 h-full w-full overflow-auto whitespace-pre-wrap break-words p-3 text-left font-mono text-[11px] leading-[1.45] text-[#dedede]",
  icon: "grid h-[108px] place-items-center",
  hero: "grid justify-items-center gap-2 px-1 pb-[18px] pt-2.5",
  heroTitle:
    "max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[17px]",
  heroKind: "text-[#949494]",
  actions:
    "mb-4 grid grid-cols-[repeat(auto-fit,minmax(70px,1fr))] gap-px overflow-hidden rounded-lg bg-[#1d1d1d]",
  actionButton:
    "grid justify-items-center gap-1.5 border-0 bg-transparent p-3 text-[#adadad] disabled:opacity-40",
  detailsCard: "overflow-hidden rounded-lg bg-[#1d1d1d]",
  detailsTitle: "border-b border-[#3f3f3f] px-3 py-2.5 text-sm",
  detailRow: "grid gap-1.5 p-3",
  detailLabel: "text-[#949494]",
  detailValue: "min-w-0 [overflow-wrap:anywhere] font-medium",
  tags: "grid gap-2 border-t border-[#333333] p-3",
  tagsTitle: "font-medium text-[#eeeeee]",
  tagsEmpty: "text-[#949494]",
  tagList: "flex flex-wrap gap-1.5",
  tagButton:
    "inline-flex min-h-[26px] items-center gap-1.5 rounded-full border border-[#3e3e3e] bg-[#202020] px-[9px] py-1 text-xs text-[#d6d6d6] disabled:opacity-55",
  tagRemoveIcon: "font-bold text-[#838383]",
  tagForm: "grid grid-cols-[minmax(0,1fr)_auto] gap-2",
  tagInput:
    "min-w-0 rounded-md border border-[#3e3e3e] bg-[#181818] px-2 py-1.5 text-[#eeeeee] outline-none focus:border-[#b1b1b1] disabled:opacity-55",
  tagSubmit:
    "inline-flex min-h-7 w-max items-center gap-1.5 rounded-md border-0 bg-[#242424] px-[9px] py-[5px] text-[#c1c1c1] disabled:opacity-55",
} as const;

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
    <aside className={inspectorStyles.root}>
      {preview || previewError || previewLoading ? (
        <div className={inspectorStyles.previewCard}>
          {previewLoading ? <span>Loading preview...</span> : null}
          {preview?.mimeType === "application/pdf" ? (
            <object className={inspectorStyles.previewMedia} data={preview.url} type={preview.mimeType} aria-label={`Preview of ${title}`} />
          ) : preview?.text != null ? (
            <pre className={inspectorStyles.previewText}>{preview.text}</pre>
          ) : preview ? (
            <img className={inspectorStyles.previewMedia} src={preview.url} alt={`Preview of ${title}`} />
          ) : null}
          {previewError ? <span>{previewError}</span> : null}
        </div>
      ) : (
        <div className={inspectorStyles.icon}>
          {displayEntry?.kind === "folder" ? <Folder size={92} className="text-[#b9b9b9]" /> : <File size={92} className="text-[#a2a2a2]" />}
        </div>
      )}

      <div className={inspectorStyles.hero}>
        <strong className={inspectorStyles.heroTitle} title={title}>{title}</strong>
        <span className={inspectorStyles.heroKind}>{kind}</span>
      </div>

      <div className={inspectorStyles.actions}>
        <button className={inspectorStyles.actionButton} type="button" disabled={!props.selectedEntry || multiple} onClick={props.onOpen}>
          <Folder size={18} />
          Open
        </button>
        <button className={inspectorStyles.actionButton} type="button" disabled={!canDownload} onClick={props.onDownload}>
          <Download size={18} />
          Download
        </button>
        <button
          className={inspectorStyles.actionButton}
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

      <section className={inspectorStyles.detailsCard}>
        <h2 className={inspectorStyles.detailsTitle}>Details</h2>
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
        <div className={inspectorStyles.tags}>
          <span className={inspectorStyles.tagsTitle}>Tags</span>
          {props.tags.length > 0 ? (
            <div className={inspectorStyles.tagList}>
              {props.tags.map((tag) => (
                <button className={inspectorStyles.tagButton} key={tag} type="button" disabled={!canEditTags} title={`Remove ${tag}`} onClick={() => removeTag(tag)}>
                  {tag}
                  <span className={inspectorStyles.tagRemoveIcon} aria-hidden="true">x</span>
                </button>
              ))}
            </div>
          ) : <small className={inspectorStyles.tagsEmpty}>No tags</small>}
          <form
            className={inspectorStyles.tagForm}
            onSubmit={(event) => {
              event.preventDefault();
              addTag();
            }}
          >
            <input
              className={inspectorStyles.tagInput}
              value={tagDraft}
              disabled={!canEditTags}
              placeholder="Add tag"
              onChange={(event) => setTagDraft(event.target.value)}
            />
            <button className={inspectorStyles.tagSubmit} type="submit" disabled={!canEditTags || !tagDraft.trim()}>
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
    const imageMimeType = previewImageMimeType(entry);
    if (!imageMimeType) {
      const sizeLimitError = previewSizeLimitError(entry);
      if (sizeLimitError) {
        setPreviewError(sizeLimitError);
        setPreviewLoading(false);
        return () => undefined;
      }
    }

    setPreviewLoading(true);
    if (imageMimeType) {
      void previewPathForEntry(entry)
        .then((path) => loadImagePreview(path, imageMimeType))
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
      };
    }

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
  return Boolean(previewImageMimeType(entry)) || extension === "pdf" || textPreviewExtensions.has(extension);
}

function previewImageMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return browserImageMimeTypes[extension] ?? null;
}

async function loadImagePreview(path: string, mimeType: string): Promise<LoadedPreview> {
  const baseUrl = convertFileSrc(path);
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
  throw lastError instanceof Error ? lastError : new Error("Unable to load image preview.");
}

function waitForImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const decode = image.decode ? image.decode().catch(() => undefined) : Promise.resolve();
      void decode.then(() => resolve());
    };
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

function kindLabel(entry: FileEntry | null): string {
  if (!entry) return "Folder";
  if (entry.kind === "folder") return "Folder";
  if (entry.kind === "symlink") return "Link";
  const extension = entry.extension.toUpperCase().replace(/^\./, "");
  return extension ? `${extension} File` : entry.kind === "file" ? "File" : "Item";
}

function Detail(props: { label: string; value: string }) {
  return (
    <div className={inspectorStyles.detailRow}>
      <span className={inspectorStyles.detailLabel}>{props.label}</span>
      <strong className={inspectorStyles.detailValue}>{props.value}</strong>
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
