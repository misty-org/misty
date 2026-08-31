import { agentsApi } from "@/api/agents/api";
import type { AiCitation, AiContextReference, AiInvocationEvent } from "@/features/ai-surface";
import { globalMistyId, normalizeActionState } from "./globalMistyActions";
import { globalMistyApi } from "./globalMistyApi";
import { globalSearchContext } from "./globalSearchDocuments";
import type { GlobalSearchState } from "./globalSearchState";
import type {
  GlobalAiActionProposal,
  GlobalAiCitation,
  GlobalAiContextRef,
  GlobalAiConversation,
  GlobalAiMessage,
  GlobalAiMode,
  GlobalSearchContextItem,
  GlobalSearchDocument,
  GlobalSearchFilters,
  GlobalSearchResult,
} from "./types";

export type GlobalSearchSet = (
  partial: Partial<GlobalSearchState> | ((state: GlobalSearchState) => Partial<GlobalSearchState>),
) => void;
export type GlobalSearchGet = () => GlobalSearchState;

let activeGlobalInvocationStream: (() => void) | undefined;
const activeGlobalAgentPolls = new Set<string>();

export function replaceActiveGlobalInvocationStream(next?: () => void) {
  activeGlobalInvocationStream?.();
  activeGlobalInvocationStream = next;
}

export function announceGlobalPanel(open: boolean) {
  window.dispatchEvent(new CustomEvent("misty:global-panel", { detail: { open } }));
}

export function globalAiContext(context: GlobalAiContextRef[]): AiContextReference[] {
  return (
    context
      // Global Ask uses server-side permission-filtered retrieval by default.
      // Only an explicit attachment is promoted into the model's context envelope.
      .filter((item) => item.attached === true && (!item.localPath || item.attached))
      .map((item) => ({
        kind: item.kind,
        id: item.id,
        title: item.title,
        privacy: item.privacy ?? (item.localPath ? "device" : item.spaceId ? "shared" : "private"),
        spaceId: item.spaceId,
        href: item.href,
        revision: item.revision,
        opaqueScopeId: item.opaqueScopeId,
        attached: item.attached,
        metadata: item.metadata ?? (item.spaceName ? { spaceName: item.spaceName } : undefined),
      }))
  );
}

export function patchConversationMessage(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  messageId: string,
  patch: Partial<GlobalAiMessage>,
) {
  updateConversation(set, get, conversationId, (conversation) => ({
    ...conversation,
    updatedAt: new Date().toISOString(),
    messages: conversation.messages.map((message) =>
      message.id === messageId ? { ...message, ...patch } : message,
    ),
  }));
}

export function applyGlobalInvocationEvent(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  messageId: string,
  event: AiInvocationEvent,
) {
  if (event.type === "response.delta") {
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    patchConversationMessage(set, get, conversationId, messageId, {
      content: `${current?.content ?? ""}${event.delta}`,
      state: "streaming",
      activity: undefined,
    });
    return;
  }
  if (event.type === "assistant.message") {
    patchConversationMessage(set, get, conversationId, messageId, {
      content: event.text,
      state: "streaming",
      activity: undefined,
    });
    return;
  }
  if (event.type === "citation") {
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    patchConversationMessage(set, get, conversationId, messageId, {
      citations: dedupeGlobalCitations([...(current?.citations ?? []), event.citation]),
    });
    return;
  }
  if (event.type === "assistant.status") {
    patchConversationMessage(set, get, conversationId, messageId, {
      activity: event.text || event.phase,
      state: "pending",
    });
    return;
  }
  if (event.type === "invocation.completed") {
    activeGlobalInvocationStream?.();
    activeGlobalInvocationStream = undefined;
    patchConversationMessage(set, get, conversationId, messageId, {
      state: "completed",
      retryable: false,
      activity: undefined,
    });
    set({ working: false });
    return;
  }
  if (event.type === "invocation.failed" || event.type === "invocation.canceled") {
    activeGlobalInvocationStream?.();
    activeGlobalInvocationStream = undefined;
    const content =
      event.type === "invocation.failed" ? event.error : "This Misty answer was canceled.";
    patchConversationMessage(set, get, conversationId, messageId, {
      content,
      state: event.type === "invocation.failed" ? "failed" : "canceled",
      retryable: event.type === "invocation.failed",
      activity: undefined,
    });
    set({ working: false, error: event.type === "invocation.failed" ? event.error : null });
  }
}

function dedupeGlobalCitations(citations: AiCitation[]) {
  return Array.from(
    new Map(
      citations.map((citation) => [
        citation.id,
        {
          id: citation.id,
          title: citation.title,
          href: citation.href,
          kind: citation.kind as GlobalAiCitation["kind"],
        },
      ]),
    ).values(),
  );
}

async function pollGlobalAgentTask(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  messageId: string,
  runId: string,
) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1_250));
    try {
      const detail = await agentsApi.run<{
        summary?: { state?: string; progress?: number; error_message?: string };
        approvals?: Array<{ id: string; state: string; summary?: string }>;
      }>(runId);
      const state = normalizeActionState(detail.summary?.state ?? "running");
      const message = get()
        .conversations.find((conversation) => conversation.id === conversationId)
        ?.messages.find((candidate) => candidate.id === messageId);
      if (!message?.action || message.action.state === "rejected") return;
      patchConversationMessage(set, get, conversationId, messageId, {
        content: isTerminalAgentState(state)
          ? state === "completed"
            ? "Misty finished the task. It remains available in Agents history."
            : detail.summary?.error_message || "The Agent task did not complete."
          : `Misty is working${detail.summary?.progress ? ` · ${detail.summary.progress}%` : ""}. You can close this window.`,
        action: {
          ...message.action,
          state,
          approvalId: detail.approvals?.find((approval) => approval.state === "pending")?.id,
          error: detail.summary?.error_message,
        },
        state: isTerminalAgentState(state)
          ? state === "failed"
            ? "failed"
            : "completed"
          : "pending",
        retryable: state === "failed",
      });
      if (isTerminalAgentState(state)) return;
    } catch {
      // The durable run remains available in Agents history if projection polling is interrupted.
    }
  }
}

export function startGlobalAgentTaskPoll(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  messageId: string,
  runId: string,
) {
  if (activeGlobalAgentPolls.has(runId)) return;
  activeGlobalAgentPolls.add(runId);
  void pollGlobalAgentTask(set, get, conversationId, messageId, runId).finally(() => {
    activeGlobalAgentPolls.delete(runId);
  });
}

export function resumeGlobalAgentPolls(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversations: GlobalAiConversation[],
) {
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const action = message.action;
      if (!action?.runId || isTerminalAgentState(action.state)) continue;
      startGlobalAgentTaskPoll(set, get, conversation.id, message.id, action.runId);
    }
  }
}

export function isTerminalAgentState(state: GlobalAiActionProposal["state"]) {
  return state === "completed" || state === "failed" || state === "rejected";
}

const lastModeKey = "misty:global-ai:last-mode:v1";

export function readLastMode(accountId: string): GlobalAiMode {
  if (!accountId) return "search";
  try {
    const value = window.localStorage.getItem(`${lastModeKey}:${accountId}`);
    return value === "ask" || value === "action" ? value : "search";
  } catch {
    return "search";
  }
}

export function writeLastMode(accountId: string, mode: GlobalAiMode) {
  if (!accountId) return;
  try {
    window.localStorage.setItem(`${lastModeKey}:${accountId}`, mode);
  } catch {
    // This preference is optional; private browsing may reject storage.
  }
}

export function localConversation(spaceId?: string): GlobalAiConversation {
  const now = new Date().toISOString();
  return {
    id: `local-${globalMistyId()}`,
    title: "New conversation",
    spaceId,
    createdAt: now,
    updatedAt: now,
    modelId: "",
    messages: [],
    remote: false,
  };
}

export function normalizeConversation(conversation: GlobalAiConversation): GlobalAiConversation {
  const now = new Date().toISOString();
  return {
    ...conversation,
    title: conversation.title?.trim() || "New conversation",
    createdAt: conversation.createdAt || now,
    updatedAt: conversation.updatedAt || now,
    modelId: conversation.modelId ?? "",
    messages: (conversation.messages ?? []).map((message) => ({
      ...message,
      state:
        message.state ??
        (message.role === "assistant" && !message.content ? "pending" : "completed"),
    })),
    remote: conversation.remote !== false,
  };
}

export function conversationMessage(
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
    state: role === "assistant" && !content ? "pending" : "completed",
    ...(action ? { action } : {}),
  };
}

export function updateConversation(
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

export function appendConversationMessage(
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

export async function askMisty(
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
    if (response.message)
      return {
        ...response.message,
        citations: response.citations ?? response.message.citations ?? [],
      };
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

export function searchResultMatchesFilters(
  result: Pick<GlobalSearchDocument, "kind" | "spaceId" | "source">,
  filters: GlobalSearchFilters,
) {
  if (filters.kinds.length && !filters.kinds.includes(result.kind)) return false;
  if (filters.spaceId && result.spaceId !== filters.spaceId) return false;
  if (filters.source === "device" && result.source !== "device") return false;
  if (filters.source === "cloud" && result.source === "device") return false;
  return true;
}

export function findProposal(conversations: GlobalAiConversation[], proposalId: string) {
  for (const conversation of conversations)
    for (const message of conversation.messages)
      if (message.action?.id === proposalId) return message.action;
  return null;
}

export function patchProposal(
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
