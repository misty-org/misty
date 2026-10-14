import type { ComponentProps } from "react";
import type { GlobalAiConversation } from "@/features/global-search/types";
import { ReasoningPicker } from "../models/ReasoningPicker";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { AgentEditor } from "../components/AgentEditor";

/** The panel's profile section: the agent editor and, mid-conversation, its thinking mode. */
export function AgentProfileSection({
  conversation,
  working,
  ...editor
}: ComponentProps<typeof AgentEditor> & {
  conversation?: GlobalAiConversation;
  working: boolean;
}) {
  return (
    <>
      <AgentEditor {...editor} />
      {conversation && (
        <div className="agent-profile-model">
          <ReasoningPicker
            inline
            conversationId={conversation.id}
            reasoningEffort={conversation.reasoningEffort}
            disabled={working}
            onChange={(changes) =>
              useMistyStore.setState((s) => ({
                conversations: s.conversations.map((c) =>
                  c.id === conversation.id ? { ...c, ...changes } : c,
                ),
              }))
            }
          />
        </div>
      )}
    </>
  );
}
