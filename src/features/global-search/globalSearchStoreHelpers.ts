import {
  useCollaborationStore,
  collaborationEventTypes,
  type CollaborationEvent,
} from "@/features/agents/agentCollaboration";
import type { AiCitation, AiContextReference, AiInvocationEvent } from "@/features/ai-surface";
import { globalMistyId } from "./globalMistyActions";
import type { GlobalSearchState } from "./globalSearchState";
import type {
  GlobalAiCitation,
  GlobalAiContextRef,
  GlobalAiConversation,
  GlobalAiMessage,
  GlobalAiMode,
  GlobalSearchDocument,
  GlobalSearchFilters,
} from "./types";

export type GlobalSearchSet = (
  partial: Partial<GlobalSearchState> | ((state: GlobalSearchState) => Partial<GlobalSearchState>),
) => void;
export type GlobalSearchGet = () => GlobalSearchState;

let activeGlobalInvocationStream: (() => void) | undefined;

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

/**
 * Streamed text waiting to be applied, per message. Each token used to copy the
 * conversation list, re-rendering everything that shows it once per token;
 * text now lands at most once per frame.
 */
interface PendingText {
  set: GlobalSearchSet;
  get: GlobalSearchGet;
  conversationId: string;
  messageId: string;
  text: string;
}
const pendingText = new Map<string, PendingText>();
let scheduledFlush: (() => void) | null = null;

function scheduleFlush() {
  if (scheduledFlush) return;
  if (typeof requestAnimationFrame === "function") {
    const frame = requestAnimationFrame(() => flushStreamedText());
    scheduledFlush = () => cancelAnimationFrame(frame);
  } else {
    const timer = setTimeout(() => flushStreamedText(), 16);
    scheduledFlush = () => clearTimeout(timer);
  }
}

/** Applies buffered streamed text now. Every other event calls this first, so
 * nothing that follows a delta can apply before the text it follows. */
export function flushStreamedText() {
  scheduledFlush?.();
  scheduledFlush = null;
  const entries = [...pendingText.values()];
  pendingText.clear();
  for (const { set, get, conversationId, messageId, text } of entries) {
    const message = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((candidate) => candidate.id === messageId);
    // A message that finished, failed or was canceled keeps its state.
    const settled =
      message?.state === "completed" ||
      message?.state === "failed" ||
      message?.state === "canceled";
    patchConversationMessage(set, get, conversationId, messageId, {
      content: `${message?.content ?? ""}${text}`,
      ...(settled ? {} : { state: "streaming" as const, activity: undefined }),
    });
  }
}

export function applyGlobalInvocationEvent(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  messageId: string,
  event: AiInvocationEvent,
) {
  if (event.type === "response.delta") {
    const key = `${conversationId}\u0000${messageId}`;
    const pending = pendingText.get(key);
    if (pending) pending.text += event.delta;
    else pendingText.set(key, { set, get, conversationId, messageId, text: event.delta });
    scheduleFlush();
    return;
  }
  flushStreamedText();
  if (event.type === "user.steering") {
    const invocationId = get().invocationId;
    const id = `${invocationId}-steering-${event.id}`;
    updateConversation(set, get, conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.some((m) => m.id === id)
        ? conversation.messages
        : [
            ...conversation.messages,
            {
              id,
              role: "user",
              mode: "ask",
              content: event.text,
              createdAt: new Date().toISOString(),
              state: "completed",
              activity: "Queued for the next safe boundary",
            },
          ],
    }));
    return;
  }
  if (event.type === "steering.received") {
    for (const message of event.messages)
      patchConversationMessage(
        set,
        get,
        conversationId,
        `${get().invocationId}-steering-${message.sequence}`,
        { activity: "Received by the agent" },
      );
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
  if (event.type === "app.request") {
    patchConversationMessage(set, get, conversationId, messageId, { appRequest: event.appRequest });
    return;
  }
  if (collaborationEventTypes.has(event.type)) {
    useCollaborationStore.getState().applyEvent(conversationId, event as CollaborationEvent);
    return;
  }
  if (event.type === "screen.request") {
    patchConversationMessage(set, get, conversationId, messageId, {
      screenRequest: { ...event.screenRequest, state: "pending" },
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

const lastModeKey = "misty:global-ai:last-mode:v1";

export function readLastMode(accountId: string): GlobalAiMode {
  if (!accountId) return "search";
  try {
    const value = window.localStorage.getItem(`${lastModeKey}:${accountId}`);
    return value === "ask" ? value : "search";
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

export function normalizeConversation(conversation: GlobalAiConversation): GlobalAiConversation {
  const now = new Date().toISOString();
  return {
    ...conversation,
    spaceId: undefined, // Historical provenance does not scope Agents.

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
): GlobalAiMessage {
  return {
    id: `message-${globalMistyId()}`,
    role,
    mode,
    content,
    createdAt: new Date().toISOString(),
    state: role === "assistant" && !content ? "pending" : "completed",
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
