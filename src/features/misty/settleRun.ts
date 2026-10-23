import {
  replaceActiveGlobalInvocationStream,
  settleConversationMessage,
  type MistyGet,
  type MistySet,
} from "./mistyStoreHelpers";
import type { GlobalAiMessage } from "./types";

/**
 * The one way a run ends in the store. Whatever ends it (the person's stop, a
 * dropped stream, the server reporting a terminal state), every reply still
 * pending or streaming settles, its tools stop running, and the working flag,
 * run ids and event stream clear together so nothing keeps animating.
 */
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
