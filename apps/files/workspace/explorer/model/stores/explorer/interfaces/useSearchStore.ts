import type { SearchResult, SearchStatus } from "@/native/contracts";
import type { SearchQueryScope } from "@/native/contracts/primitives";

export interface SearchStore {
  open: boolean;
  query: string;
  scope: SearchQueryScope;
  currentPath: string;
  results: SearchResult[];
  searching: boolean;
  status: SearchStatus | null;
  error: string | null;
  initialized: boolean;
  initialize: () => Promise<void>;
  openSearch: (currentPath: string) => Promise<void>;
  closeSearch: () => void;
  setQuery: (query: string) => void;
  setScope: (scope: SearchQueryScope) => void;
  refreshStatus: () => Promise<void>;
  startScan: (currentPath: string) => Promise<void>;
  cancelScan: () => Promise<void>;
  executeSearch: () => Promise<void>;
}
