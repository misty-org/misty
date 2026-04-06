import { Archive, FileText, Folder, Music } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import {
  archiveList,
  explorerGenerateImageThumbnail,
  explorerListDirectory,
  explorerPrepareOpenItem,
  explorerPreviewItem,
  fileMetadataSnapshot,
} from "@/services/misty-api/misty";
import type {
  ArchiveEntry,
  DirectoryListing,
  FileEntry,
  FileMetadataSnapshot,
  PreparedOpenItem,
} from "@/services/misty-api/types";
import { errorText } from "@/shared/format";
import { safeTauriAssetUrl } from "@/shared/tauri";
import { formatBytes } from "../utils/fileFormat";
import { FileIcon } from "./FileBrowserIcons";
import { inspectorStyles } from "./FileInspectorStyles";

export interface LoadedInspectorPreview {
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
  "txt",
  "text",
  "log",
  "md",
  "markdown",
  "toml",
  "yaml",
  "yml",
  "ini",
  "conf",
  "cfg",
  "csv",
  "tsv",
  "rs",
  "go",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "html",
  "xml",
  "sh",
  "zsh",
  "bash",
  "fish",
  "py",
  "rb",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "swift",
  "kt",
  "sql",
  "json",
  "jsonc",
]);

export function useFileMetadata(entry: FileEntry | null): {
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

export function useFolderPreview(
  entry: FileEntry | null,
  listing: DirectoryListing | null,
): {
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
  }, [
    entry?.id,
    entry?.modifiedMs,
    entry?.path,
    entry?.remoteModified,
    listing?.path,
    listing?.entries,
  ]);

  return { entries, loading, error };
}

export function useFilePreview(
  entry: FileEntry | null,
  enabled = true,
): {
  preview: LoadedInspectorPreview | null;
  previewError: string | null;
  previewLoading: boolean;
} {
  const [preview, setPreview] = useState<LoadedInspectorPreview | null>(null);
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
    const videoMimeType = previewVideoMimeType(entry);
    const audioMimeType = previewAudioMimeType(entry);
    setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      if (!active) return;
      const settle = (request: Promise<LoadedInspectorPreview>) => {
        void request
          .then((loadedPreview) => {
            if (active) setPreview(loadedPreview);
          })
          .catch((error) => {
            if (active) setPreviewError(previewErrorTextForDisplay(error));
          })
          .finally(() => {
            if (active) setPreviewLoading(false);
          });
      };
      if (videoMimeType) return settle(loadDirectMediaPreview(entry, "video", videoMimeType));
      if (audioMimeType) return settle(loadDirectMediaPreview(entry, "audio", audioMimeType));
      if (archivePreviewSupported(entry)) return settle(loadArchivePreview(entry));
      if (nativeImageThumbnailSupported(entry)) return settle(loadNativeImagePreview(entry));

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

export function PreviewImage(props: { className: string; src: string; alt: string }) {
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

export function AudioPreview(props: { preview: LoadedInspectorPreview; title: string }) {
  return (
    <div className={inspectorStyles.audioPreview} aria-label={`Audio preview of ${props.title}`}>
      <div className={inspectorStyles.audioIcon} aria-hidden="true">
        <Music size={25} />
      </div>
      <audio
        className={inspectorStyles.audioControl}
        src={props.preview.url}
        controls
        preload="metadata"
      />
    </div>
  );
}

export function ArchiveContentsPreview(props: { preview: LoadedInspectorPreview }) {
  const entries = props.preview.archiveEntries ?? [];
  const totalCount = props.preview.archiveTotalCount ?? entries.length;
  if (totalCount === 0)
    return <span className={inspectorStyles.previewStatus}>Archive is empty</span>;
  return (
    <div className={inspectorStyles.folderPreview} aria-label="Archive contents preview">
      <div className={inspectorStyles.archivePreviewSummary}>
        <span>{props.preview.archiveFormat ?? "archive"}</span>
        <span>
          {totalCount} {totalCount === 1 ? "item" : "items"}
        </span>
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
                {entry.isDir ? (
                  <Folder size={20} />
                ) : archiveEntryIsArchive(entry.path) ? (
                  <Archive size={20} />
                ) : (
                  <FileText size={20} />
                )}
              </div>
              <span className={inspectorStyles.folderPreviewName} title={entry.path}>
                {name}
              </span>
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

export function FolderContentsPreview(props: {
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  onOpenEntry: (entry: FileEntry) => void;
}) {
  if (props.loading)
    return <span className={inspectorStyles.previewStatus}>Loading contents...</span>;
  if (props.entries.length === 0) {
    return (
      <span className={inspectorStyles.previewStatus}>{props.error ?? "Folder is empty"}</span>
    );
  }
  return (
    <div className={inspectorStyles.folderPreview} aria-label="Directory contents preview">
      <div className={inspectorStyles.folderPreviewList}>
        {props.entries.map((entry) => (
          <Button
            variant="ghost"
            className={inspectorStyles.folderPreviewItem}
            key={entry.id}
            type="button"
            aria-label={
              entry.kind === "folder" ? `Open folder ${entry.name}` : `Open ${entry.name}`
            }
            title={entry.name}
            onClick={() => props.onOpenEntry(entry)}
          >
            <div className={inspectorStyles.folderPreviewThumb}>
              <FileIcon entry={entry} size={21} variant="table" />
            </div>
            <span className={inspectorStyles.folderPreviewName} title={entry.name}>
              {entry.name}
            </span>
            <span className={inspectorStyles.folderPreviewSize}>
              {entry.kind === "folder" ? "" : formatBytes(entry.sizeBytes)}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function folderPreviewEntries(entries: FileEntry[]): FileEntry[] {
  return entries.filter((candidate) => !candidate.isDeleted).slice(0, FOLDER_PREVIEW_LIMIT);
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
  return (
    Boolean(previewImageMimeType(entry)) ||
    Boolean(previewVideoMimeType(entry)) ||
    Boolean(previewAudioMimeType(entry)) ||
    nativeImageThumbnailSupported(entry) ||
    archivePreviewSupported(entry) ||
    extension === "pdf" ||
    textPreviewExtensions.has(extension)
  );
}

function previewImageMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  return browserImageMimeTypes[entry.extension.toLowerCase().replace(/^\./, "")] ?? null;
}

async function loadNativeImagePreview(entry: FileEntry): Promise<LoadedInspectorPreview> {
  const payload = await explorerGenerateImageThumbnail(
    entry.path,
    INSPECTOR_IMAGE_PREVIEW_MAX_DIMENSION,
    {
      modifiedMs: entry.modifiedMs,
      remoteModified: entry.remoteModified,
      sizeBytes: entry.sizeBytes,
    },
  );
  return {
    kind: "image",
    text: null,
    url: safeTauriAssetUrl(payload.path),
    mimeType: payload.mimeType,
  };
}

function previewVideoMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  return browserVideoMimeTypes[entry.extension.toLowerCase().replace(/^\./, "")] ?? null;
}

function previewAudioMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  return browserAudioMimeTypes[entry.extension.toLowerCase().replace(/^\./, "")] ?? null;
}

function archivePreviewSupported(entry: FileEntry): boolean {
  return (
    entry.kind !== "folder" &&
    entry.kind !== "symlink" &&
    archivePreviewExtensions.has(normalizedArchiveExtension(entry))
  );
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
): Promise<LoadedInspectorPreview> {
  const preparedPath = await previewPathForEntry(entry);
  return { kind, text: null, url: safeTauriAssetUrl(preparedPath.path), mimeType };
}

async function loadArchivePreview(entry: FileEntry): Promise<LoadedInspectorPreview> {
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
  return message.toLowerCase().includes("too large to thumbnail") ? null : message;
}

function nativeImageThumbnailSupported(entry: FileEntry): boolean {
  return nativeImageThumbnailExtensions.has(entry.extension.toLowerCase().replace(/^\./, ""));
}

function previewPayloadIsText(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType.startsWith("application/json");
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
