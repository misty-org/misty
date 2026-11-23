import { currentConversationForPrompt } from "../state/global_misty_conversation_scope";
import {
  conversationMessage,
  updateConversation,
  type MistyGet,
  type MistySet,
} from "../state/misty_store_updates";
import type { MistyImageAttachment } from "../state/conversation_types";

export function echoPrompt(
  set: MistySet,
  get: MistyGet,
  input: {
    prompt: string;
    attachments: MistyImageAttachment[];
    echoed: boolean;
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
    settle(conversationId: string) {
      if (shownIn === conversationId) shownIn = undefined;
      else unshow(false);
    },
  };
}
