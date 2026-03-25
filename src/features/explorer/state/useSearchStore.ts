import { create } from "zustand";
import {
  searchCancelScan,
  searchGetStatus,
  searchInit,
  searchQuery,
  searchStartScan,
} from "../../../api/misty";
import type { SearchQueryScope, SearchResult, SearchStatus } from "../../../api/types";
import { errorText } from "../../../shared/format";
import { useExplorerStore } from "./useExplorerStore";
import { mergeLibrarySearchResults } from "../utils/librarySearch";

const searchDebounceMs = 180;
const activeStatusPollMs = 500;
const idleStatusPollMs = 5000;

interface SearchStore {
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

let debounceTimer: number | null = null;
let statusPollTimer: number | null = null;
let querySequence = 0;

export const useSearchStore = create<SearchStore>((set, get) => ({
  open: false,
  query: "",
  scope: "everything",
  currentPath: "",
  results: [],
  searching: false,
  status: null,
  error: null,
  initialized: false,
  initialize: async () => {
    try {
      const status = get().initialized ? await searchGetStatus() : await searchInit();
      set({ initialized: true, status });
    } catch (error) {
      set({ initialized: true, error: errorText(error) });
    }
  },
  openSearch: async (currentPath) => {
    set({ open: true, currentPath, error: null });
    await get().initialize();
    scheduleStatusPolling();
    scheduleSearch();
  },
  closeSearch: () => {
    clearSearchDebounce();
    set({ open: false, searching: false });
    stopStatusPolling();
  },
  setQuery: (query) => {
    set({ query });
    scheduleSearch();
  },
  setScope: (scope) => {
    set({ scope });
    scheduleSearch(0);
  },
  refreshStatus: async () => {
    try {
      const status = await searchGetStatus();
      set({ status, error: null });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },
  startScan: async (currentPath) => {
    try {
      const status = await searchStartScan({
        includeLocal: true,
        includeRemotes: true,
        roots: [],
        maxDepth: null,
      });
      set({ status, currentPath, error: null });
      scheduleStatusPolling();
    } catch (error) {
      set({ error: errorText(error) });
    }
  },
  cancelScan: async () => {
    try {
      const status = await searchCancelScan();
      set({ status, error: null });
      scheduleStatusPolling();
    } catch (error) {
      set({ error: errorText(error) });
    }
  },
  executeSearch: async () => {
    clearSearchDebounce();
    const { query, scope, currentPath, status } = get();
    const trimmed = query.trim();
    const sequence = ++querySequence;
    if (!trimmed) {
      set({ results: [], searching: false });
      return;
    }
    set({ searching: true, error: null });
    try {
      const backendResults = !status || status.indexedItemCount === 0
        ? []
        : await searchQuery({
            query: trimmed,
            scope,
            currentPath,
            includeFiles: true,
            includeDirectories: true,
            includeHidden: false,
            limit: 100,
          });
      const results = mergeLibrarySearchResults(
        backendResults,
        useExplorerStore.getState().library,
        trimmed,
        { scope, currentPath, limit: 100 },
      );
      if (sequence === querySequence) {
        set({ results, searching: false, error: null });
      }
    } catch (error) {
      if (sequence === querySequence) {
        const results = mergeLibrarySearchResults(
          [],
          useExplorerStore.getState().library,
          trimmed,
          { scope, currentPath, limit: 100 },
        );
        set({ results, searching: false, error: results.length > 0 ? null : errorText(error) });
      }
    }
  },
}));

function scheduleSearch(delay = searchDebounceMs): void {
  clearSearchDebounce();
  debounceTimer = window.setTimeout(() => {
    void useSearchStore.getState().executeSearch();
  }, delay);
}

function clearSearchDebounce(): void {
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function scheduleStatusPolling(): void {
  stopStatusPolling();
  const poll = async () => {
    await useSearchStore.getState().refreshStatus();
    const status = useSearchStore.getState().status;
    const active = Boolean(status?.scanInProgress);
    if (useSearchStore.getState().open || active) {
      statusPollTimer = window.setTimeout(poll, active ? activeStatusPollMs : idleStatusPollMs);
    }
  };
  statusPollTimer = window.setTimeout(poll, activeStatusPollMs);
}

function stopStatusPolling(): void {
  if (statusPollTimer !== null) {
    window.clearTimeout(statusPollTimer);
    statusPollTimer = null;
  }
}
