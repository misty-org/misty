import { create } from "zustand";
import { searchCancelScan, searchGetStatus, searchInit, searchStartScan } from "../api/misty";
import type { SearchQueryScope, SearchResult, SearchStatus } from "../api/types";
import { userFacingErrorText } from "@/shared/format";
import { useExplorerStore } from "./useExplorerStore";
import { mergeLibrarySearchResults } from "../features/explorer/utils/librarySearch";
import {
  mergeHybridSearchResults,
  queryIndexedExplorerSearch,
  querySemanticExplorerSearch,
  semanticQueryMinimumCharacters,
  semanticSearchDebounceMs,
} from "../features/explorer/utils/globalSearch";

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
let semanticDebounceTimer: number | null = null;
let statusPollTimer: number | null = null;
let querySequence = 0;
let indexedResults: SearchResult[] = [];
let semanticResults: SearchResult[] = [];
let indexedError: string | null = null;

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
      set({ initialized: true, error: userFacingErrorText(error) });
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
    querySequence += 1;
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
      set({ error: userFacingErrorText(error) });
    }
  },
  startScan: async (currentPath) => {
    try {
      const status = await searchStartScan({
        includeLocal: true,
        includeRemotes: true,
        roots: [],
        maxDepth: null,
        incremental: true,
      });
      set({ status, currentPath, error: null });
      scheduleStatusPolling();
    } catch (error) {
      set({ error: userFacingErrorText(error) });
    }
  },
  cancelScan: async () => {
    try {
      const status = await searchCancelScan();
      set({ status, error: null });
      scheduleStatusPolling();
    } catch (error) {
      set({ error: userFacingErrorText(error) });
    }
  },
  executeSearch: async () => {
    clearSearchDebounce();
    const { query } = get();
    const trimmed = query.trim();
    const sequence = ++querySequence;
    if (!trimmed) {
      indexedResults = [];
      semanticResults = [];
      indexedError = null;
      set({ results: [], searching: false });
      return;
    }
    set({ searching: true, error: null });
    await executeIndexedSearch(sequence);
    if (trimmed.replace(/\s/g, "").length >= semanticQueryMinimumCharacters)
      await executeSemanticSearch(sequence);
  },
}));

function scheduleSearch(delay = searchDebounceMs): void {
  clearSearchDebounce();
  const sequence = ++querySequence;
  indexedResults = [];
  semanticResults = [];
  indexedError = null;
  debounceTimer = window.setTimeout(() => {
    void executeIndexedSearch(sequence);
  }, delay);
  const query = useSearchStore.getState().query.trim();
  if (query.replace(/\s/g, "").length >= semanticQueryMinimumCharacters) {
    semanticDebounceTimer = window.setTimeout(
      () => {
        void executeSemanticSearch(sequence);
      },
      Math.max(delay, semanticSearchDebounceMs),
    );
  }
}

function clearSearchDebounce(): void {
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (semanticDebounceTimer !== null) {
    window.clearTimeout(semanticDebounceTimer);
    semanticDebounceTimer = null;
  }
}

async function executeIndexedSearch(sequence: number): Promise<void> {
  const { query, scope, currentPath, status } = useSearchStore.getState();
  const trimmed = query.trim();
  if (!trimmed || sequence !== querySequence) return;
  useSearchStore.setState({ searching: true, error: null });
  try {
    indexedResults =
      !status || status.indexedItemCount === 0
        ? mergeLibrarySearchResults([], useExplorerStore.getState().library, trimmed, {
            scope,
            currentPath,
            limit: 100,
          })
        : await queryIndexedExplorerSearch(
            trimmed,
            { scope, currentPath, limit: 100 },
            useExplorerStore.getState().library,
          );
    indexedError = null;
  } catch (error) {
    indexedResults = mergeLibrarySearchResults([], useExplorerStore.getState().library, trimmed, {
      scope,
      currentPath,
      limit: 100,
    });
    indexedError = userFacingErrorText(error);
  }
  if (sequence !== querySequence) return;
  const results = mergeHybridSearchResults(indexedResults, semanticResults, 100);
  useSearchStore.setState({
    results,
    searching: semanticDebounceTimer !== null,
    error: results.length > 0 ? null : indexedError,
  });
}

async function executeSemanticSearch(sequence: number): Promise<void> {
  semanticDebounceTimer = null;
  const { query, scope, currentPath } = useSearchStore.getState();
  const trimmed = query.trim();
  if (!trimmed || sequence !== querySequence) return;
  useSearchStore.setState({ searching: true });
  try {
    semanticResults = await querySemanticExplorerSearch(trimmed, {
      scope,
      currentPath,
      limit: 100,
    });
  } catch {
    // Offline/unconfigured semantic search is intentionally a silent local-only fallback.
    semanticResults = [];
  }
  if (sequence !== querySequence) return;
  const results = mergeHybridSearchResults(indexedResults, semanticResults, 100);
  useSearchStore.setState({
    results,
    searching: false,
    error: results.length > 0 ? null : indexedError,
  });
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
