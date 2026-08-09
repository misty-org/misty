import type { SearchQueryScope } from "@/services/misty/model/types/misty-api";

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
