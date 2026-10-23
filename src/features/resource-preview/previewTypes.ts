import type { ComponentProps, ComponentType } from "react";
import type { SystemErrorNotice } from "@/features/support/systemErrors";
import type { ArchiveEntry } from "@/native/ipc";

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
  peer?: boolean;
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

export type PreviewErrorComponent = ComponentType<ComponentProps<typeof SystemErrorNotice>>;
