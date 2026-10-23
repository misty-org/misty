import { mergeGlobalMistyContext, uniqueGlobalMistyContext } from "./globalMistyContext";
import type { MistyState } from "./mistyState";
import type { MistyGet, MistySet } from "./mistyStoreHelpers";
import { announceGlobalPanel } from "./mistyStoreHelpers";

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
        browserRequest: undefined,
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
      set({
        panel: "closed",
        ...(get().browserRequest ? { context: [] } : {}),
        browserRequest: undefined,
      });
    },
    setQuery: (query) => set({ query }),
    setContext: (context) => set({ context: uniqueGlobalMistyContext(context) }),
    removeContext: (id) =>
      set({
        context: get().context.filter((item) => item.id !== id),
        ...(get().browserRequest?.context.some((item) => item.id === id)
          ? { browserRequest: undefined }
          : {}),
      }),
  };
}
