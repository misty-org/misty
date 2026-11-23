import { resolveSetting, useDevicePreferences } from "@/features/settings";
import type { GlobalAiConversation, GlobalAiMessage } from "../state/conversation_types";

export { awaitConversationTitle } from "../state/conversation_titles";

export const planDeepThinking = () => {
  const profile = useDevicePreferences.getState().state;
  return Boolean(profile && resolveSetting(profile, "agents.plan_deep_thinking").value);
};

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
        : turn.continuation
          ? [{ ...turn.userMessage, source: "continuation" as const }]
          : []),
      turn.assistantMessage,
    ],
  };
}
