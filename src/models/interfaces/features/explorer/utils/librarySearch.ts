import type {
  FileKind,
  SearchQueryScope,
  SearchSourceKind,
} from "@/models/types/services/misty-api";
import type {
  ExplorerLibraryItem,
  ExplorerLibrarySnapshot,
  ExplorerLocation,
  FileEntry,
  SearchResult,
} from "@/models/interfaces/services/misty-api";

export interface LibrarySearchOptions {
  currentPath?: string | null;
  scope?: SearchQueryScope;
  limit?: number | null;
}

export interface ParsedLibraryQuery {
  terms: string[];
  tags: string[];
  comments: string[];
}
