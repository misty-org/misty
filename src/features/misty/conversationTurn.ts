import { resolveSetting, useSettingsProfiles } from "@/features/settings";
import type { GlobalAiConversation, GlobalAiMessage } from "@/features/global-search/types";

export { awaitConversationTitle } from "./conversationTitles";

/** Plan mode thinks deeply when the account asks for it. */
export const planDeepThinking = () => {
  const profile = useSettingsProfiles.getState().state;
  return Boolean(profile && resolveSetting(profile, "agents.plan_deep_thinking").value);
};

/**
 * The conversation with a new turn: the person's message (unless the echo
 * already shows it) and the assistant's reply to come. A new conversation is
 * titled from its opening words until the server names it.
 */
export function openTurn(
  conversation: GlobalAiConversation,
  turn: {
    prompt: string;
    userMessage: GlobalAiMessage;
    assistantMessage: GlobalAiMessage;
    isEcho: (message: GlobalAiMessage) => boolean;
    echoed: boolean;
    continuation: boolean;
    reasoningEffort: GlobalAiConversation["reasoningEffort"];
  },
): GlobalAiConversation {
  const messages = conversation.messages.filter((message) => !turn.isEcho(message));
  return {
    ...conversation,
    reasoningEffort: turn.reasoningEffort,
    title: messages.length ? conversation.title : turn.prompt.slice(0, 56),
    updatedAt: turn.userMessage.createdAt,
    messages: [
      ...messages,
      ...(turn.echoed
        ? [turn.userMessage]
        : // A continuation shows as an event line ("Connected Google Docs"), not as typed text.
          turn.continuation
          ? [{ ...turn.userMessage, source: "continuation" as const }]
          : []),
      turn.assistantMessage,
    ],
  };
}
