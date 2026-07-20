import { useCallback, useState } from "react";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { Input } from "@/ui";
import {
  compareApplyTextMerge,
  compareFiles,
  compareFolders,
  explorerPreviewItem,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
} from "@/stores/backend";
import type {
  CompareFilesResult,
  CompareFolderRow,
  CompareFoldersResult,
  PasteItem,
} from "@/models/interfaces/services/misty-api";
import { useOperationQueueStore } from "@/stores/explorer";
import { useExplorerStore } from "@/stores/explorer";
import { errorText } from "@/lib/format";
import { formatBytes } from "@/features/explorer/utils/fileFormat";
import { cx } from "@/features/explorer/desktop/ExplorerDesktopShared";
import { compareStyles } from "@/features/explorer/desktop/ExplorerDesktopDialogStyles";

import type {
  CompareMode,
  CompareTextDiffKind,
} from "@/models/types/features/explorer/desktop/ExplorerCompareDialog";

export interface CompareDialogSeed {
  paneId: string;
  leftPath: string;
  mode: CompareMode;
}

export interface CompareTextDiffRow {
  id: string;
  leftLine: number | null;
  rightLine: number | null;
  leftText: string;
  rightText: string;
  kind: CompareTextDiffKind;
}

export interface CompareTextDiffState {
  leftText: string;
  rightText: string;
  rows: CompareTextDiffRow[];
  truncated: boolean;
}

export interface CompareImagePreview {
  src: string;
  mimeType: string;
  byteLength: number;
}

export interface CompareImageState {
  left: CompareImagePreview;
  right: CompareImagePreview;
}
