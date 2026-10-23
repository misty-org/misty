import type { AiContextReference } from "@/features/ai-surface";
import { globalMistyId } from "./globalMistyActions";
import type { MistyState } from "./mistyState";
import { settleProgress } from "@/features/agents";
import type { GlobalAiContextRef, GlobalAiConversation, GlobalAiMessage } from "./types";

export type MistySet = (
  partial: Partial<MistyState> | ((state: MistyState) => Partial<MistyState>),
) => void;
export type MistyGet = () => MistyState;

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
  set: MistySet,
  get: MistyGet,
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

/** Ends a reply that will get no more events: its tools stop running and its
 * activity line clears, so nothing keeps animating on a finished message. */
export function settleConversationMessage(
  set: MistySet,
  get: MistyGet,
  conversationId: string,
  messageId: string,
  patch: Partial<GlobalAiMessage> & { state: NonNullable<GlobalAiMessage["state"]> },
) {
  updateConversation(set, get, conversationId, (conversation) => ({
    ...conversation,
    updatedAt: new Date().toISOString(),
    messages: conversation.messages.map((message) =>
      message.id === messageId
        ? { ...message, ...patch, progress: settleProgress(message.progress), activity: undefined }
        : message,
    ),
  }));
}

/**
 * Streamed text waiting to be applied, per message. Each token used to copy the
 * conversation list, re-rendering everything that shows it once per token;
 * text now lands at most once per frame.
 */
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
  set: MistySet,
  get: MistyGet,
  conversationId: string,
  update: (conversation: GlobalAiConversation) => GlobalAiConversation,
) {
  set({
    conversations: get().conversations.map((conversation) =>
      conversation.id === conversationId ? update(conversation) : conversation,
    ),
  });
}

export { applyGlobalInvocationEvent, flushStreamedText } from "./mistyInvocationEvents";
