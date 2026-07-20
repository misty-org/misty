import { FileSearch, Maximize2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/ui";
import type {
  DirectoryListing,
  DirectorySizeRecord,
  FileEntry,
} from "@/models/interfaces/services/misty-api";
import { directorySizeRecordForPath } from "@/stores/explorer";
import { formatBytes, formatDate } from "@/features/explorer/utils/fileFormat";
import { GlobalPreviewDialog } from "@/features/explorer/components/GlobalPreview";
import {
  ArchiveContentsPreview,
  AudioPreview,
  FolderContentsPreview,
  PreviewImage,
  useFileMetadata,
  useFilePreview,
  useFolderPreview,
} from "@/features/explorer/components/FileInspectorPreview";
import { inspectorStyles } from "@/features/explorer/components/FileInspectorStyles";

export interface FileInspectorProps {
  listing: DirectoryListing | null;
  selectedEntry: FileEntry | null;
  selectedCount: number;
  directorySizes: Record<string, DirectorySizeRecord>;
  onOpenEntry: (entry: FileEntry) => void;
  onPreviewSaved?: () => void | Promise<void>;
}
