import { uniqueGlobalMistyContext } from "../context/globalMistyContext";
import type { MistyState } from "./mistyState";
import type { MistyGet, MistySet } from "./mistyStoreUpdates";

export function createMistyPanelState(
  set: MistySet,
  get: MistyGet,
): Pick<
  MistyState,
  | "accountId"
  | "query"
  | "working"
  | "conversationsLoading"
  | "error"
  | "context"
  | "conversations"
  | "activeConversationId"
  | "setAccount"
  | "setQuery"
  | "setContext"
  | "removeContext"
> {
  return {
    accountId: "",
    query: "",
    working: false,
    conversationsLoading: false,
    error: null,
    context: [],
    conversations: [],
    activeConversationId: "",
    setAccount: (accountId) => {
      const normalized = accountId.trim();
      if (normalized === get().accountId) return;
      set({
        accountId: normalized,
        query: "",
        working: false,
        conversationsLoading: false,
        error: null,
        context: [],
        conversations: [],
        activeConversationId: "",
      });
    },
    setQuery: (query) => set({ query }),
    setContext: (context) => set({ context: uniqueGlobalMistyContext(context) }),
    removeContext: (id) => set({ context: get().context.filter((item) => item.id !== id) }),
  };
}
