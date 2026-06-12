import type { SearchQueryScope } from "@/native/contracts/primitives";

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
