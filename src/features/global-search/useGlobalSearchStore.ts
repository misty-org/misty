import { create } from "zustand";
import { createGlobalSearchPanelState } from "./globalSearchPanelState";
import { executeGlobalSearch, executeGlobalVisualSearch } from "./globalSearchExecution";
import type { GlobalSearchState } from "./globalSearchState";

export { globalSearchContext } from "./globalSearchContext";
export type { GlobalSearchState, MistySubmissionPresentation } from "./globalSearchState";

// Search owns retrieval and launcher state only. Compatibility methods hand off
// explicitly; no conversation or model execution lives in this store.
export const useGlobalSearchStore = create<GlobalSearchState>((set, get) => {
  const handoff = async (prompt: string) => {
    const { openMisty } = await import("@/features/misty/handoff");
    await openMisty({ prompt, context: get().context });
    get().closePanel();
  };
  return {
    ...createGlobalSearchPanelState(set, get),
    setMode: () => set({ mode: "search" }),
    setAccount: (accountId) => {
      if (accountId === get().accountId) return;
      set({
        accountId,
        mode: "search",
        query: "",
        results: [],
        context: [],
        panel: "closed",
        error: null,
        requestId: get().requestId + 1,
      });
    },
    search: (query) => executeGlobalSearch(set, get, query),
    visualSearch: (id, query) => executeGlobalVisualSearch(set, get, id, query),
    loadConversations: async () => {},
    newConversation: async () => {
      await handoff("");
      return "";
    },
    bindConversationSpace: async () => {},
    selectConversation: () => {},
    deleteConversation: async () => {},
    renameConversation: async () => {},
    submit: () => handoff(get().query),
    submitAnswer: (prompt) => handoff(prompt),
    submitAgentTask: (prompt) => handoff(prompt),
    approveAgentTask: async () => {},
    cancelAgentTask: async () => {},
    confirmAction: async () => {},
    rejectAction: () => {},
  };
});
