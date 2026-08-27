import { mergeGlobalMistyContext, uniqueGlobalMistyContext } from "./globalMistyContext";
import type { GlobalSearchState } from "./globalSearchState";
import type { GlobalSearchGet, GlobalSearchSet } from "./globalSearchStoreHelpers";
import { announceGlobalPanel, readLastMode, writeLastMode } from "./globalSearchStoreHelpers";

export function createGlobalSearchPanelState(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
): Pick<
  GlobalSearchState,
  | "accountId"
  | "panel"
  | "mode"
  | "query"
  | "results"
  | "searching"
  | "enriched"
  | "working"
  | "conversationsLoading"
  | "error"
  | "requestId"
  | "context"
  | "conversations"
  | "activeConversationId"
  | "filters"
  | "selectedCandidateId"
  | "setAccount"
  | "activateLauncher"
  | "togglePanel"
  | "openPanel"
  | "closePanel"
  | "setMode"
  | "setQuery"
  | "setFilters"
  | "setSelectedCandidateId"
  | "setContext"
  | "removeContext"
  | "clear"
> {
  return {
    accountId: "",
    panel: "closed",
    mode: "search",
    query: "",
    results: [],
    searching: false,
    enriched: false,
    working: false,
    conversationsLoading: false,
    error: null,
    requestId: 0,
    context: [],
    conversations: [],
    activeConversationId: "",
    filters: { kinds: [], source: "all", intent: "all" },
    selectedCandidateId: "",
    setAccount: (accountId) => {
      const normalized = accountId.trim();
      if (normalized === get().accountId) return;
      announceGlobalPanel(false);
      set((state) => ({
        accountId: normalized,
        panel: "closed",
        mode: readLastMode(normalized),
        query: "",
        results: [],
        searching: false,
        enriched: false,
        working: false,
        conversationsLoading: false,
        error: null,
        context: [],
        conversations: [],
        activeConversationId: "",
        filters: { kinds: [], source: "all", intent: "all" },
        selectedCandidateId: "",
        requestId: state.requestId + 1,
      }));
    },
    activateLauncher: () => {
      announceGlobalPanel(true);
      set({ panel: get().mode === "search" ? "results" : "answer", error: null });
    },
    togglePanel: () => {
      const panel =
        get().panel === "closed" ? (get().mode === "search" ? "results" : "answer") : "closed";
      announceGlobalPanel(panel !== "closed");
      set({ panel, error: null });
    },
    openPanel: (context = []) => {
      announceGlobalPanel(true);
      set({
        panel: get().mode === "search" ? "results" : "answer",
        context: mergeGlobalMistyContext(get().context, context),
        error: null,
      });
      if (!get().conversations.length && !get().conversationsLoading)
        void get().loadConversations();
    },
    closePanel: () => {
      announceGlobalPanel(false);
      set({ panel: "closed" });
    },
    setMode: (mode) => {
      writeLastMode(get().accountId, mode);
      set((state) => ({
        mode,
        panel: state.panel === "closed" ? "closed" : mode === "search" ? "results" : "answer",
        error: null,
      }));
      if (mode === "search" && get().query.trim()) void get().search(get().query);
    },
    setQuery: (query) =>
      set((state) => ({
        query,
        panel:
          state.mode === "search" && (state.panel === "answer" || state.panel === "agent")
            ? "results"
            : state.panel,
        selectedCandidateId: "",
        requestId: state.requestId + 1,
      })),
    setFilters: (filters) =>
      set((state) => ({ filters, selectedCandidateId: "", requestId: state.requestId + 1 })),
    setSelectedCandidateId: (selectedCandidateId) => set({ selectedCandidateId }),
    setContext: (context) => set({ context: uniqueGlobalMistyContext(context) }),
    removeContext: (id) => set({ context: get().context.filter((item) => item.id !== id) }),
    clear: () =>
      set((state) => ({
        query: "",
        results: [],
        searching: false,
        enriched: false,
        error: null,
        requestId: state.requestId + 1,
      })),
  };
}
