import type {
  DirectoryListing,
  DirectorySizeRecord,
  FileEntry,
} from "@/services/misty/model/misty-api";

export interface FileInspectorProps {
  listing: DirectoryListing | null;
  selectedEntry: FileEntry | null;
  selectedCount: number;
  directorySizes: Record<string, DirectorySizeRecord>;
  onOpenEntry: (entry: FileEntry) => void;
  onPreviewSaved?: () => void | Promise<void>;
}
