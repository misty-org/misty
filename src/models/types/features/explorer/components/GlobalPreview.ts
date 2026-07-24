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

import type {
  GlobalPreviewSource,
  PreviewResource,
} from "@/models/interfaces/features/explorer/components/GlobalPreview";

export type GlobalPreviewKind = PreviewResource["kind"];
