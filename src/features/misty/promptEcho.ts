import { currentConversationForPrompt } from "@/features/global-search/globalMistyConversationScope";
import {
  conversationMessage,
  updateConversation,
  type GlobalSearchGet,
  type GlobalSearchSet,
} from "@/features/global-search/globalSearchStoreHelpers";
import type { MistyImageAttachment } from "@/features/global-search/types";

/**
 * A prompt and its pending answer, echoed into the conversation in the same
 * update that starts the work, so the message lands before any status and
 * preparation can't reorder them.
 */
export function echoPrompt(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  input: {
    prompt: string;
    attachments: MistyImageAttachment[];
    /** Whether the prompt shows as a user message at all. */
    echoed: boolean;
    /** The conversation the prompt was sent from, when known. */
    conversationId: string | undefined;
  },
) {
  const userMessage = {
    ...conversationMessage("user", "ask", input.prompt),
    attachments: input.attachments,
  };
  const assistantMessage = conversationMessage("assistant", "ask", "");
  const before = get();
  let shownIn = input.echoed
    ? currentConversationForPrompt({
        ...before,
        activeConversationId: input.conversationId ?? before.activeConversationId,
      })
    : undefined;
  const clearedQuery = shownIn && before.query.trim() === input.prompt ? before.query : undefined;
  const isEcho = (message: { id: string }) =>
    message.id === userMessage.id || message.id === assistantMessage.id;
  /** Takes the echo back when the prompt never reaches its conversation. */
  const unshow = (restoreQuery = true) => {
    const conversationId = shownIn;
    if (!conversationId) return;
    shownIn = undefined;
    updateConversation(set, get, conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.filter((message) => !isEcho(message)),
    }));
    if (
      restoreQuery &&
      clearedQuery !== undefined &&
      get().accountId === before.accountId &&
      !get().query
    )
      set({ query: clearedQuery });
  };
  const shownConversation = shownIn;
  return {
    echoed: input.echoed,
    userMessage,
    assistantMessage,
    isEcho,
    unshow,
    /** State to merge into the update that starts the work. */
    patch: {
      ...(shownConversation
        ? {
            conversations: before.conversations.map((conversation) =>
              conversation.id === shownConversation
                ? {
                    ...conversation,
                    messages: [...conversation.messages, userMessage, assistantMessage],
                  }
                : conversation,
            ),
          }
        : {}),
      ...(clearedQuery !== undefined ? { query: "" } : {}),
    },
    /** The prompt reached `conversationId`: an echo already there stays; one shown elsewhere moves. */
    settle(conversationId: string) {
      if (shownIn === conversationId) shownIn = undefined;
      else unshow(false);
    },
  };
}
