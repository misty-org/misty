import type { ExplorerLocation, FileEntry } from "./app-explorer";
export interface DirectoryListing {
  path: string;
  title?: string | null;
  parentPath: string | null;
  location: ExplorerLocation;
  entries: FileEntry[];
  totalCount: number;
  hiddenCount: number;
  modifiedMs?: number | null;
  createdMs?: number | null;
}
export interface ListDirectoryRequest {
  path?: string | null;
  showHidden?: boolean;
  forceRemoteRefresh?: boolean;
}
