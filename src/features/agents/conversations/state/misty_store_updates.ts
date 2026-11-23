import type { AiContextReference } from "../../runs/invocations";
import { globalMistyId } from "./global_misty_actions";
import type { MistyState } from "./misty_state";
import { settleProgress } from "../../progress/progress_timeline";
import type {
  GlobalAiContextRef,
  GlobalAiConversation,
  GlobalAiMessage,
} from "./conversation_types";

export type MistySet = (
  partial: Partial<MistyState> | ((state: MistyState) => Partial<MistyState>),
) => void;
export type MistyGet = () => MistyState;

let activeGlobalInvocationStream: (() => void) | undefined;

export function replaceActiveGlobalInvocationStream(next?: () => void) {
  activeGlobalInvocationStream?.();
  activeGlobalInvocationStream = next;
}

export function globalAiContext(context: GlobalAiContextRef[]): AiContextReference[] {
  return context
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
    }));
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

export { applyGlobalInvocationEvent, flushStreamedText } from "../ask/misty_invocation_events";
