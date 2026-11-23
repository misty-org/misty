import { uniqueGlobalMistyContext } from "../context/global_misty_context";
import type { MistyState } from "./misty_state";
import type { MistyGet, MistySet } from "./misty_store_updates";

export function createMistyPanelState(
  set: MistySet,
  get: MistyGet,
): Pick<
  MistyState,
  | "accountId"
  | "query"
  | "working"
  | "conversationsLoading"
  | "conversationsError"
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
    conversationsError: null,
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
        conversationsError: null,
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
