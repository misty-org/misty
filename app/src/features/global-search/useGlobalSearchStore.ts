import {
  queryIndexedExplorerSearch,
  querySemanticExplorerSearch,
  useExplorerStore,
} from "@/features/files/explorer";
import { useSpacesStore } from "@/features/spaces";
import { create } from "zustand";
import {
  globalMistyError,
  globalMistyId,
  normalizeActionState,
  proposeAction,
} from "./globalMistyActions";
import { globalMistyApi } from "./globalMistyApi";
import { mergeGlobalMistyContext, uniqueGlobalMistyContext } from "./globalMistyContext";
import {
  buildLocalIndex,
  globalSearchContext,
  mapFileResults,
  mergeResults,
  searchDocuments,
  searchServerTasks,
} from "./globalSearchDocuments";
import type {
  GlobalAiActionProposal,
  GlobalAiContextRef,
  GlobalAiConversation,
  GlobalAiMessage,
  GlobalAiMode,
  GlobalSearchContextItem,
  GlobalSearchDocument,
  GlobalSearchResult,
} from "./types";
export { globalSearchContext } from "./globalSearchDocuments";

export interface GlobalSearchState {
  accountId: string;
  launcherOpen: boolean;
  open: boolean;
  mode: GlobalAiMode;
  query: string;
  results: GlobalSearchResult[];
  searching: boolean;
  enriched: boolean;
  working: boolean;
  conversationsLoading: boolean;
  error: string | null;
  requestId: number;
  context: GlobalAiContextRef[];
  conversations: GlobalAiConversation[];
  activeConversationId: string;
  setAccount: (accountId: string) => void;
  activateLauncher: () => void;
  openPanel: (context?: GlobalAiContextRef[]) => void;
  closePanel: () => void;
  setMode: (mode: GlobalAiMode) => void;
  setQuery: (query: string) => void;
  setContext: (context: GlobalAiContextRef[]) => void;
  removeContext: (id: string) => void;
  clear: () => void;
  search: (query: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  newConversation: () => Promise<string>;
  selectConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => Promise<void>;
  submit: () => Promise<void>;
  confirmAction: (proposalId: string) => Promise<void>;
  rejectAction: (proposalId: string) => void;
}

export const useGlobalSearchStore = create<GlobalSearchState>((set, get) => ({
  accountId: "",
  launcherOpen: false,
  open: false,
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
  setAccount: (accountId) => {
    const normalized = accountId.trim();
    if (normalized === get().accountId) return;
    set((state) => ({
      accountId: normalized,
      launcherOpen: false,
      open: false,
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
      requestId: state.requestId + 1,
    }));
  },
  activateLauncher: () => set({ launcherOpen: true, open: false, error: null }),
  openPanel: (context = []) => {
    set({
      launcherOpen: false,
      open: true,
      context: mergeGlobalMistyContext(get().context, context),
      error: null,
    });
    if (!get().conversations.length && !get().conversationsLoading) void get().loadConversations();
  },
  closePanel: () => set({ launcherOpen: false, open: false }),
  setMode: (mode) => {
    writeLastMode(get().accountId, mode);
    set({ mode, error: null });
    if (mode === "search" && get().query.trim()) void get().search(get().query);
  },
  setQuery: (query) => set({ query }),
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
  search: async (query) => {
    const trimmed = query.trim();
    const accountId = get().accountId;
    const requestId = get().requestId + 1;
    if (!trimmed || !accountId) {
      set({
        query: trimmed,
        results: [],
        searching: false,
        enriched: false,
        error: null,
        requestId,
      });
      return;
    }
    const local = searchDocuments(buildLocalIndex(accountId), trimmed, 24);
    set({
      query: trimmed,
      results: local,
      searching: true,
      enriched: false,
      error: null,
      requestId,
    });
    if (trimmed.length < 2) {
      set({ searching: false });
      return;
    }

    const spaces = useSpacesStore.getState().spaces;
    const explorer = useExplorerStore.getState();
    const options = { scope: "everything" as const, currentPath: "", limit: 30 };
    const requests: Array<Promise<GlobalSearchDocument[]>> = [
      queryIndexedExplorerSearch(trimmed, options, explorer.library).then((results) =>
        mapFileResults(results, accountId),
      ),
      querySemanticExplorerSearch(trimmed, options).then((results) =>
        mapFileResults(results, accountId),
      ),
      globalMistyApi
        .search(trimmed)
        .then((response) => response.hits)
        .catch(() => searchServerTasks(accountId, trimmed, spaces)),
    ];
    const settled = await Promise.allSettled(requests);
    if (get().requestId !== requestId || get().accountId !== accountId) return;
    const remoteDocuments = settled.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    const merged = mergeResults(local, searchDocuments(remoteDocuments, trimmed, 36), 36);
    const failures = settled.filter((result) => result.status === "rejected").length;
    set({
      results: merged,
      searching: false,
      enriched: settled.some((result) => result.status === "fulfilled"),
      error:
        failures === settled.length ? "Server search is unavailable. Showing local results." : null,
    });
  },
  loadConversations: async () => {
    const accountId = get().accountId;
    if (!accountId) return;
    set({ conversationsLoading: true });
    try {
      const response = await globalMistyApi.conversations();
      if (get().accountId !== accountId) return;
      const conversations = response.conversations.map(normalizeConversation);
      set({
        conversations,
        activeConversationId: get().activeConversationId || conversations[0]?.id || "",
        conversationsLoading: false,
      });
    } catch {
      if (get().accountId === accountId) set({ conversationsLoading: false });
    }
  },
  newConversation: async () => {
    const fallback = localConversation();
    let conversation = fallback;
    try {
      conversation = normalizeConversation(
        await globalMistyApi.createConversation("New conversation"),
      );
    } catch {
      // Older servers keep the conversation in memory for this app session.
    }
    set({
      conversations: [
        conversation,
        ...get().conversations.filter((item) => item.id !== conversation.id),
      ],
      activeConversationId: conversation.id,
      error: null,
    });
    return conversation.id;
  },
  selectConversation: (activeConversationId) => set({ activeConversationId, error: null }),
  deleteConversation: async (conversationId) => {
    const existing = get().conversations.find((item) => item.id === conversationId);
    set({
      conversations: get().conversations.filter((item) => item.id !== conversationId),
      activeConversationId:
        get().activeConversationId === conversationId
          ? (get().conversations.find((item) => item.id !== conversationId)?.id ?? "")
          : get().activeConversationId,
    });
    if (!existing?.remote) return;
    try {
      await globalMistyApi.deleteConversation(conversationId);
    } catch (error) {
      set({ error: globalMistyError(error) });
    }
  },
  submit: async () => {
    const prompt = get().query.trim();
    const mode = get().mode;
    if (!prompt || mode === "search" || get().working) return;
    const accountId = get().accountId;
    const conversationId = get().activeConversationId || (await get().newConversation());
    const userMessage = conversationMessage("user", mode, prompt);
    updateConversation(set, get, conversationId, (conversation) => ({
      ...conversation,
      title: conversation.messages.length ? conversation.title : prompt.slice(0, 56),
      updatedAt: userMessage.createdAt,
      messages: [...conversation.messages, userMessage],
    }));
    set({ working: true, error: null, query: "" });
    try {
      if (mode === "ask") {
        const message = await askMisty(conversationId, prompt, get().context, get().results);
        if (get().accountId !== accountId) return;
        appendConversationMessage(set, get, conversationId, message);
      } else {
        const localProposal = proposeAction(prompt);
        let proposal = localProposal;
        try {
          const response = await globalMistyApi.turn(conversationId, {
            mode: "action",
            prompt,
            context: get().context.filter((item) => !item.localPath || item.attached),
            agentId: localProposal.agentId,
          });
          if (response.action) proposal = { ...localProposal, ...response.action };
        } catch {
          // Compatibility path: the existing delegation endpoint still executes the proposal.
        }
        appendConversationMessage(
          set,
          get,
          conversationId,
          conversationMessage("assistant", "action", proposal.summary, proposal),
        );
        if (!proposal.requiresConfirmation) void get().confirmAction(proposal.id);
      }
    } catch (error) {
      if (get().accountId === accountId) set({ error: globalMistyError(error) });
    } finally {
      if (get().accountId === accountId) set({ working: false });
    }
  },
  confirmAction: async (proposalId) => {
    const located = findProposal(get().conversations, proposalId);
    if (!located) return;
    patchProposal(set, get, proposalId, { state: "running", error: undefined });
    set({ working: true, error: null });
    try {
      let completed: Partial<GlobalAiActionProposal>;
      try {
        const remote = await globalMistyApi.decideProposal(proposalId, true);
        completed = remote;
      } catch {
        const response = await globalMistyApi.delegate(located);
        completed = {
          state: normalizeActionState(response.run?.state ?? response.status),
          runId: response.run?.id,
          error: response.run?.error_message,
        };
      }
      patchProposal(set, get, proposalId, completed);
    } catch (error) {
      patchProposal(set, get, proposalId, { state: "failed", error: globalMistyError(error) });
    } finally {
      set({ working: false });
    }
  },
  rejectAction: (proposalId) => {
    patchProposal(set, get, proposalId, { state: "rejected" });
    void globalMistyApi.decideProposal(proposalId, false).catch(() => undefined);
  },
}));

type GlobalSearchSet = (
  partial: Partial<GlobalSearchState> | ((state: GlobalSearchState) => Partial<GlobalSearchState>),
) => void;
type GlobalSearchGet = () => GlobalSearchState;

const lastModeKey = "misty:global-ai:last-mode:v1";

function readLastMode(accountId: string): GlobalAiMode {
  if (!accountId) return "search";
  try {
    const value = window.localStorage.getItem(`${lastModeKey}:${accountId}`);
    return value === "ask" || value === "action" ? value : "search";
  } catch {
    return "search";
  }
}

function writeLastMode(accountId: string, mode: GlobalAiMode) {
  if (!accountId) return;
  try {
    window.localStorage.setItem(`${lastModeKey}:${accountId}`, mode);
  } catch {
    // This preference is optional; private browsing may reject storage.
  }
}

function localConversation(): GlobalAiConversation {
  const now = new Date().toISOString();
  return {
    id: `local-${globalMistyId()}`,
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    messages: [],
    remote: false,
  };
}

function normalizeConversation(conversation: GlobalAiConversation): GlobalAiConversation {
  const now = new Date().toISOString();
  return {
    ...conversation,
    title: conversation.title?.trim() || "New conversation",
    createdAt: conversation.createdAt || now,
    updatedAt: conversation.updatedAt || now,
    messages: conversation.messages ?? [],
    remote: conversation.remote !== false,
  };
}

function conversationMessage(
  role: GlobalAiMessage["role"],
  mode: GlobalAiMessage["mode"],
  content: string,
  action?: GlobalAiActionProposal,
): GlobalAiMessage {
  return {
    id: `message-${globalMistyId()}`,
    role,
    mode,
    content,
    createdAt: new Date().toISOString(),
    ...(action ? { action } : {}),
  };
}

function updateConversation(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  update: (conversation: GlobalAiConversation) => GlobalAiConversation,
) {
  set({
    conversations: get().conversations.map((conversation) =>
      conversation.id === conversationId ? update(conversation) : conversation,
    ),
  });
}

function appendConversationMessage(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  message: GlobalAiMessage,
) {
  updateConversation(set, get, conversationId, (conversation) => ({
    ...conversation,
    updatedAt: message.createdAt,
    messages: [...conversation.messages, message],
  }));
}

async function askMisty(
  conversationId: string,
  prompt: string,
  context: GlobalAiContextRef[],
  results: GlobalSearchResult[],
): Promise<GlobalAiMessage> {
  const safeContext = context.filter((item) => !item.localPath || item.attached);
  try {
    const response = await globalMistyApi.turn(conversationId, {
      mode: "ask",
      prompt,
      context: safeContext,
    });
    if (response.message) return response.message;
    if (response.text)
      return {
        ...conversationMessage("assistant", "ask", response.text),
        citations: response.citations ?? citationsForResults(results),
      };
  } catch {
    // Compatibility path for servers that predate persistent Global Misty turns.
  }
  const retrieval = globalSearchContext(results, 10);
  const response = await globalMistyApi.complete(buildGroundedPrompt(prompt, retrieval));
  return {
    ...conversationMessage("assistant", "ask", response.text),
    citations: citationsForResults(results),
  };
}

function buildGroundedPrompt(prompt: string, context: GlobalSearchContextItem[]): string {
  const sources = context
    .map(
      (item, index) =>
        `[${index + 1}] ${item.kind}: ${item.title}${item.space ? ` (${item.space})` : ""}\n${item.snippet}`,
    )
    .join("\n\n");
  return [
    "You are Misty, the account-wide AI inside the Misty app.",
    "Answer concisely. Ground Misty-specific claims only in the supplied sources. If the sources are insufficient, say so plainly.",
    `User request: ${prompt}`,
    sources ? `Sources:\n${sources}` : "No Misty sources matched this request.",
  ].join("\n\n");
}

function citationsForResults(results: GlobalSearchResult[]) {
  return results.slice(0, 8).map((result) => ({
    id: result.id,
    title: result.title,
    href: result.href,
    kind: result.kind,
  }));
}

function findProposal(conversations: GlobalAiConversation[], proposalId: string) {
  for (const conversation of conversations)
    for (const message of conversation.messages)
      if (message.action?.id === proposalId) return message.action;
  return null;
}

function patchProposal(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  proposalId: string,
  patch: Partial<GlobalAiActionProposal>,
) {
  set({
    conversations: get().conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.action?.id === proposalId
          ? { ...message, action: { ...message.action, ...patch } }
          : message,
      ),
    })),
  });
}
