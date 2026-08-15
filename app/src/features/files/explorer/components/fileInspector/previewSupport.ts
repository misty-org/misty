import {
  archiveList,
  explorerGenerateImageThumbnail,
  explorerPrepareOpenItem,
  connectedDevicesMediaUrl,
} from "@/features/files/native";
import type { ArchiveEntry, FileEntry } from "@/native/contracts";
import { errorText } from "@/shared/lib/format";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";
import type {
  LoadedInspectorPreview,
  PreparedPreviewPath,
} from "../../model/interfaces/components/FileInspectorPreview";
import { formatBytes } from "../../utils/fileFormat";
import {
  FOLDER_PREVIEW_LIMIT,
  INSPECTOR_IMAGE_PREVIEW_MAX_DIMENSION,
  archivePreviewExtensions,
  browserAudioMimeTypes,
  browserImageMimeTypes,
  browserVideoMimeTypes,
  nativeImageThumbnailExtensions,
  textPreviewExtensions,
} from "./previewConstants";

export function folderPreviewEntries(entries: FileEntry[]): FileEntry[] {
  return entries.filter((candidate) => !candidate.isDeleted).slice(0, FOLDER_PREVIEW_LIMIT);
}

export async function previewPathForEntry(entry: FileEntry): Promise<PreparedPreviewPath> {
  if (entry.location.kind === "local") return { path: entry.path, prepared: null };
  const prepared = await explorerPrepareOpenItem({
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    remoteModified: entry.remoteModified,
  });
  return { path: prepared.localPath, prepared };
}

export function previewSupported(entry: FileEntry): boolean {
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

export function previewImageMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  return browserImageMimeTypes[entry.extension.toLowerCase().replace(/^\./, "")] ?? null;
}

export async function loadNativeImagePreview(entry: FileEntry): Promise<LoadedInspectorPreview> {
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

export function previewVideoMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  return browserVideoMimeTypes[entry.extension.toLowerCase().replace(/^\./, "")] ?? null;
}

export function previewAudioMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  return browserAudioMimeTypes[entry.extension.toLowerCase().replace(/^\./, "")] ?? null;
}

export function archivePreviewSupported(entry: FileEntry): boolean {
  return (
    entry.kind !== "folder" &&
    entry.kind !== "symlink" &&
    archivePreviewExtensions.has(normalizedArchiveExtension(entry))
  );
}

export function normalizedArchiveExtension(entry: FileEntry): string {
  const name = entry.name.toLowerCase();
  for (const compoundExtension of ["tar.gz", "tar.bz2", "tar.xz"]) {
    if (name.endsWith(`.${compoundExtension}`)) return compoundExtension;
  }
  return entry.extension.toLowerCase().replace(/^\./, "");
}

export async function loadDirectMediaPreview(
  entry: FileEntry,
  kind: "image" | "video" | "audio",
  mimeType: string,
): Promise<LoadedInspectorPreview> {
  if (entry.location.kind === "peer_device") {
    return { kind, text: null, url: await connectedDevicesMediaUrl(entry.path), mimeType };
  }
  const preparedPath = await previewPathForEntry(entry);
  return { kind, text: null, url: safeTauriAssetUrl(preparedPath.path), mimeType };
}

export async function loadArchivePreview(entry: FileEntry): Promise<LoadedInspectorPreview> {
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

export function previewErrorTextForDisplay(error: unknown): string | null {
  const message = errorText(error);
  return message.toLowerCase().includes("too large to thumbnail") ? null : message;
}

export function nativeImageThumbnailSupported(entry: FileEntry): boolean {
  return nativeImageThumbnailExtensions.has(entry.extension.toLowerCase().replace(/^\./, ""));
}

export function previewPayloadIsText(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType.startsWith("application/json");
}

export function archiveEntryName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").filter(Boolean).pop() ?? path;
}

export function archiveEntryIsArchive(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return [...archivePreviewExtensions].some((extension) => lowerPath.endsWith(`.${extension}`));
}

export function formatArchiveEntrySize(entry: ArchiveEntry): string {
  const size = entry.uncompressedSize || entry.compressedSize;
  return size > 0 ? formatBytes(size) : "";
}
