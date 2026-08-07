import { create } from "zustand";
import { searchCancelScan, searchGetStatus, searchInit, searchStartScan } from "@/stores/backend";
import type { SearchQueryScope } from "@/models/types/services/misty-api";
import type { SearchResult, SearchStatus } from "@/models/interfaces/services/misty-api";
import { userFacingErrorText } from "@/lib/format";
import { useExplorerStore } from "@/stores/explorer";
import { mergeLibrarySearchResults } from "@/features/explorer/utils/librarySearch";
import {
  mergeHybridSearchResults,
  queryIndexedExplorerSearch,
  querySemanticExplorerSearch,
  semanticQueryMinimumCharacters,
  semanticSearchDebounceMs,
} from "@/features/explorer/utils/globalSearch";

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
