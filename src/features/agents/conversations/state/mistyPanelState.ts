import { mergeGlobalMistyContext, uniqueGlobalMistyContext } from "../context/globalMistyContext";
import type { MistyState } from "./mistyState";
import type { MistyGet, MistySet } from "./mistyStoreUpdates";
import { announceGlobalPanel } from "./mistyStoreUpdates";

export function createMistyPanelState(
  set: MistySet,
  get: MistyGet,
): Pick<
  MistyState,
  | "accountId"
  | "panel"
  | "query"
  | "working"
  | "conversationsLoading"
  | "error"
  | "context"
  | "conversations"
  | "activeConversationId"
  | "setAccount"
  | "openPanel"
  | "closePanel"
  | "setQuery"
  | "setContext"
  | "removeContext"
> {
  return {
    accountId: "",
    panel: "closed",
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
      announceGlobalPanel(false);
      set({
        accountId: normalized,
        panel: "closed",
        query: "",
        working: false,
        conversationsLoading: false,
        error: null,
        context: [],
        conversations: [],
        activeConversationId: "",
      });
    },
    openPanel: (context = []) => {
      announceGlobalPanel(true);
      set({
        panel: "answer",
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
    setQuery: (query) => set({ query }),
    setContext: (context) => set({ context: uniqueGlobalMistyContext(context) }),
    removeContext: (id) => set({ context: get().context.filter((item) => item.id !== id) }),
  };
}
