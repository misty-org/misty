import { Archive, FileText, Folder, Music } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/ui";
import {
  archiveList,
  explorerGenerateImageThumbnail,
  explorerListDirectory,
  explorerPrepareOpenItem,
  explorerPreviewItem,
  fileMetadataSnapshot,
} from "@/stores/backend";
import type {
  ArchiveEntry,
  DirectoryListing,
  FileEntry,
  FileMetadataSnapshot,
  PreparedOpenItem,
} from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";
import { safeTauriAssetUrl } from "@/platform/tauri";
import { formatBytes } from "@/features/explorer/utils/fileFormat";
import { FileIcon } from "@/features/explorer/components/FileBrowserIcons";
import { inspectorStyles } from "@/features/explorer/components/FileInspectorStyles";

export interface LoadedInspectorPreview {
  kind: "image" | "video" | "audio" | "pdf" | "text" | "archive";
  text: string | null;
  url: string;
  mimeType: string;
  archiveEntries?: ArchiveEntry[];
  archiveFormat?: string;
  archiveTotalCount?: number;
}

export interface PreparedPreviewPath {
  path: string;
  prepared: PreparedOpenItem | null;
}
