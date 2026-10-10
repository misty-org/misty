import { thinkingEffort, thinkingMode } from "@/features/agents/thinkingMode";
import type { GlobalAiConversation } from "@/features/global-search/types";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { ReasoningPicker } from "./ReasoningPicker";

/**
 * The composer's thinking switch, beside the model switch. A conversation keeps
 * its own effort; before the conversation exists, the choice rides along with
 * the first message.
 */
export function ConversationReasoningPicker({
  conversation,
  disabled,
}: {
  conversation?: GlobalAiConversation;
  disabled?: boolean;
}) {
  const draftMode = useMistyStore((s) => s.thinkingMode);
  const effort = conversation?.reasoningEffort || thinkingEffort(draftMode ?? "normal");
  return (
    <ReasoningPicker
      conversationId={conversation?.id}
      reasoningEffort={effort}
      disabled={disabled}
      className="h-7 px-2 text-xs text-cream-muted"
      onChange={({ reasoningEffort }) =>
        useMistyStore.setState((s) => ({
          thinkingModeExplicit: true,
          thinkingMode: thinkingMode(reasoningEffort),
          conversations: s.conversations.map((c) =>
            c.id === conversation?.id ? { ...c, reasoningEffort } : c,
          ),
        }))
      }
    />
  );
}
