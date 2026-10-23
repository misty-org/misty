import {
  useCollaborationStore,
  collaborationEventTypes,
  type CollaborationEvent,
} from "@/features/agents/agentCollaboration";
import type { AiCitation, AiInvocationEvent } from "@/features/ai-surface";
import { settleProgress, withAnswer, withToolEvent } from "@/features/agents";
import type { GlobalAiCitation } from "./types";

import {
  patchConversationMessage,
  replaceActiveGlobalInvocationStream,
  updateConversation,
  type MistyGet,
  type MistySet,
} from "./mistyStoreHelpers";

interface PendingText {
  set: MistySet;
  get: MistyGet;
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
  set: MistySet,
  get: MistyGet,
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
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    patchConversationMessage(set, get, conversationId, messageId, {
      ...withAnswer(current ?? {}, event.text),
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
  if (event.type === "notebook.updated") {
    patchConversationMessage(set, get, conversationId, messageId, { notebook: event.notebook });
    return;
  }
  if (event.type === "delegation.updated") {
    patchConversationMessage(set, get, conversationId, messageId, {
      subagents: event.delegation.children,
    });
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
  if (
    event.type === "tool.started" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "tool.detail"
  ) {
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    if (current)
      patchConversationMessage(set, get, conversationId, messageId, withToolEvent(current, event));
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
    replaceActiveGlobalInvocationStream();
    patchConversationMessage(set, get, conversationId, messageId, {
      state: "completed",
      retryable: false,
      activity: undefined,
    });
    set({ working: false });
    return;
  }
  if (event.type === "invocation.failed" || event.type === "invocation.canceled") {
    replaceActiveGlobalInvocationStream();
    const content =
      event.type === "invocation.failed" ? event.error : "This Misty answer was canceled.";
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    patchConversationMessage(set, get, conversationId, messageId, {
      content,
      progress: settleProgress(current?.progress),
      state: event.type === "invocation.failed" ? "failed" : "canceled",
      retryable: event.type === "invocation.failed",
      activity: undefined,
    });
    // The transcript shows how the run ended; no popup over the composer.
    set({ working: false, error: null });
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
