import { Textarea } from "@/ui";
import { Button } from "@/ui";
import { Dialog, DialogContent, DialogTitle } from "@/ui";
import { Copy, ExternalLink, FileArchive, FileQuestion, Loader2, Save, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  archiveList,
  explorerOpenPath,
  explorerPrepareOpenItem,
  explorerPreviewItem,
  explorerSavePreviewItem,
  fetchPreviewBytes,
} from "@/stores/backend";
import type { ArchiveEntry } from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";
import { safeTauriAssetUrl } from "@/platform/tauri";
import { formatBytes, formatDate } from "@/features/explorer/utils/fileFormat";

import type { GlobalPreviewKind } from "@/models/types/features/explorer/components/GlobalPreview";

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
