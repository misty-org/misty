import type { SearchResult, SearchStatus } from "@/services/misty/model/misty-api";
import type { SearchQueryScope } from "@/services/misty/model/types/misty-api";

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
