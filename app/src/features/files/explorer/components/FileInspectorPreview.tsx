export type {
  LoadedInspectorPreview,
  PreparedPreviewPath,
} from "../model/interfaces/components/FileInspectorPreview";
export {
  ArchiveContentsPreview,
  AudioPreview,
  FolderContentsPreview,
  PreviewImage,
} from "./fileInspector/previewViews";

import {
  explorerListDirectory,
  explorerPreviewItem,
  fileMetadataSnapshot,
} from "@/features/files/native";
import type { DirectoryListing, FileEntry, FileMetadataSnapshot } from "@/native/contracts";
import { errorText } from "@/shared/lib/format";
import { useEffect, useState } from "react";
import type { LoadedInspectorPreview } from "../model/interfaces/components/FileInspectorPreview";
import {
  FILE_METADATA_LOAD_DELAY_MS,
  FILE_PREVIEW_LOAD_DELAY_MS,
} from "./fileInspector/previewConstants";
import {
  archivePreviewSupported,
  folderPreviewEntries,
  loadArchivePreview,
  loadDirectMediaPreview,
  loadNativeImagePreview,
  nativeImageThumbnailSupported,
  previewAudioMimeType,
  previewErrorTextForDisplay,
  previewPathForEntry,
  previewPayloadIsText,
  previewSupported,
  previewVideoMimeType,
} from "./fileInspector/previewSupport";

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
  }, [entry]);

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
  }, [entry, listing]);

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
  }, [enabled, entry]);

  return { preview, previewError, previewLoading };
}
