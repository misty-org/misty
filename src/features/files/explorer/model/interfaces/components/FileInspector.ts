import type { DirectoryListing, DirectorySizeRecord, FileEntry } from "@/native/contracts";

export interface FileInspectorProps {
  listing: DirectoryListing | null;
  selectedEntry: FileEntry | null;
  selectedCount: number;
  directorySizes: Record<string, DirectorySizeRecord>;
  onOpenEntry: (entry: FileEntry) => void;
  onPreviewSaved?: () => void | Promise<void>;
}
