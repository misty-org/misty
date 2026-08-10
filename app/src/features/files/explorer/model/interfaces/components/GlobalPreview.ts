import type { ArchiveEntry } from "@/native/contracts";

export interface GlobalPreviewSource {
  path: string;
  name: string;
  extension?: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  modifiedMs?: number | null;
  createdMs?: number | null;
  description?: string | null;
  tags?: string[];
  originalName?: string | null;
  uploadedMs?: number | null;
  readonly?: boolean;
  remote?: boolean;
}

export interface PreviewResource {
  kind:
    "image" | "video" | "audio" | "pdf" | "markdown" | "text" | "document" | "archive" | "generic";
  url?: string;
  text?: string;
  mimeType: string;
  archiveEntries?: ArchiveEntry[];
  archiveFormat?: string;
}
