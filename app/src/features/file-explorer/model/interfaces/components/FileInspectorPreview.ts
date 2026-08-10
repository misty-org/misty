import type { ArchiveEntry, PreparedOpenItem } from "@/services/misty/model/misty-api";

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
