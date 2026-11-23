import {
  replaceActiveGlobalInvocationStream,
  settleConversationMessage,
  type MistyGet,
  type MistySet,
} from "../state/misty_store_updates";
import type { GlobalAiMessage } from "../state/conversation_types";

export function settleRun(
  set: MistySet,
  get: MistyGet,
  outcome: {
    state: "completed" | "failed" | "canceled";
    conversationId?: string;
    error?: string | null;
    patch?: Partial<GlobalAiMessage>;
  },
) {
  const conversationId =
    outcome.conversationId ?? get().invocationConversationId ?? get().activeConversationId;
  const open = get()
    .conversations.find((conversation) => conversation.id === conversationId)
    ?.messages.filter(
      (message) =>
        message.role === "assistant" &&
        (message.state === "pending" || message.state === "streaming"),
    );
  for (const message of open ?? [])
    settleConversationMessage(set, get, conversationId, message.id, {
      state: outcome.state,
      retryable: outcome.state === "failed" ? false : message.retryable,
      ...outcome.patch,
    });
  replaceActiveGlobalInvocationStream();
  set({
    working: false,
    invocationId: undefined,
    invocationConversationId: undefined,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  });
}
