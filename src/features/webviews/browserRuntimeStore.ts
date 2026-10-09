import { create } from "zustand";
import type { ActiveBrowserAgentGrant } from "./browserAgentAccess";
import type {
  BrowserCompatibilityIssue,
  BrowserHistory,
  HistoryStep,
  PagePreview,
} from "./browserRuntimeTypes";

/** Per-tab browser state the UI renders: history, errors, notices, grants and previews. */
export interface BrowserRuntimeUiState {
  /** Local, session-only thumbnails. Never included in workspace persistence or sync. */
  previews: Record<string, PagePreview>;
  grants: Record<string, ActiveBrowserAgentGrant[]>;
  histories: Record<string, BrowserHistory>;
  errors: Record<string, string | null>;
  notices: Record<string, string | null>;
  compatibilityIssues: Record<string, BrowserCompatibilityIssue | null>;
  loading: Record<string, boolean>;
  setGrants: (tabId: string, grants: ActiveBrowserAgentGrant[]) => void;
  ensureHistory: (tabId: string, url: string) => void;
  pushHistory: (tabId: string, url: string) => void;
  moveHistory: (tabId: string, direction: -1 | 1) => string | null;
  travelHistory: (tabId: string, direction: -1 | 1) => HistoryStep | null;
  replaceHistory: (tabId: string, history: BrowserHistory) => void;
  resetNativeHistory: (tabId: string) => void;
  setError: (tabId: string, error: string | null) => void;
  setNotice: (tabId: string, notice: string | null) => void;
  setCompatibilityIssue: (tabId: string, issue: BrowserCompatibilityIssue | null) => void;
  setLoading: (tabId: string, loading: boolean) => void;
  removeTab: (tabId: string) => void;
}

export const useBrowserRuntimeStore = create<BrowserRuntimeUiState>((set, get) => ({
  previews: {},
  grants: {},
  histories: {},
  errors: {},
  notices: {},
  compatibilityIssues: {},
  loading: {},
  setGrants: (tabId, grants) => set((state) => ({ grants: { ...state.grants, [tabId]: grants } })),
  ensureHistory: (tabId, url) =>
    set((state) =>
      state.histories[tabId]
        ? state
        : { histories: { ...state.histories, [tabId]: { entries: [url], index: 0 } } },
    ),
  pushHistory: (tabId, url) =>
    set((state) => {
      const current = state.histories[tabId] ?? { entries: [url], index: 0 };
      if (current.entries[current.index] === url) return state;
      const existingIndex = current.entries.lastIndexOf(url);
      const index = current.index + 1;
      const native = current.native;
      const next =
        existingIndex >= 0 && Math.abs(existingIndex - current.index) === 1
          ? { ...current, index: existingIndex }
          : {
              entries: [...current.entries.slice(0, current.index + 1), url],
              index,
              // The webview pushed this entry too.
              native:
                native && native.lo <= current.index && current.index <= native.hi
                  ? { lo: native.lo, hi: index }
                  : { lo: index, hi: index },
            };
      return { histories: { ...state.histories, [tabId]: next } };
    }),
  moveHistory: (tabId, direction) => {
    const current = get().histories[tabId];
    if (!current) return null;
    const index = current.index + direction;
    if (index < 0 || index >= current.entries.length) return null;
    set((state) => ({
      histories: { ...state.histories, [tabId]: { ...current, index } },
    }));
    return current.entries[index] ?? null;
  },
  travelHistory: (tabId, direction) => {
    const current = get().histories[tabId];
    if (!current) return null;
    const index = current.index + direction;
    const url = current.entries[index];
    if (index < 0 || url === undefined) return null;
    const range = current.native;
    const native = Boolean(
      range &&
      range.lo <= current.index &&
      current.index <= range.hi &&
      range.lo <= index &&
      index <= range.hi,
    );
    set((state) => ({
      histories: {
        ...state.histories,
        // A direct load leaves the webview knowing only the loaded entry.
        [tabId]: { ...current, index, native: native ? range : { lo: index, hi: index } },
      },
    }));
    return { url, native };
  },
  replaceHistory: (tabId, history) =>
    set((state) => ({
      histories: {
        ...state.histories,
        [tabId]: { ...history, native: { lo: history.index, hi: history.index } },
      },
    })),
  resetNativeHistory: (tabId) =>
    set((state) => {
      const current = state.histories[tabId];
      if (!current) return state;
      return {
        histories: {
          ...state.histories,
          [tabId]: { ...current, native: { lo: current.index, hi: current.index } },
        },
      };
    }),
  setError: (tabId, error) =>
    set((state) => ({
      errors: { ...state.errors, [tabId]: error },
      ...(error ? { loading: { ...state.loading, [tabId]: false } } : {}),
    })),
  setNotice: (tabId, notice) =>
    set((state) => ({ notices: { ...state.notices, [tabId]: notice } })),
  setCompatibilityIssue: (tabId, issue) =>
    set((state) => ({
      compatibilityIssues: { ...state.compatibilityIssues, [tabId]: issue },
    })),
  setLoading: (tabId, loading) =>
    set((state) => ({ loading: { ...state.loading, [tabId]: loading } })),
  removeTab: (tabId) =>
    set((state) => {
      const grants = { ...state.grants };
      const histories = { ...state.histories };
      const errors = { ...state.errors };
      const notices = { ...state.notices };
      const compatibilityIssues = { ...state.compatibilityIssues };
      const loading = { ...state.loading };
      const previews = { ...state.previews };
      delete grants[tabId];
      delete histories[tabId];
      delete errors[tabId];
      delete notices[tabId];
      delete compatibilityIssues[tabId];
      delete loading[tabId];
      delete previews[tabId];
      return { grants, histories, errors, notices, compatibilityIssues, loading, previews };
    }),
}));
