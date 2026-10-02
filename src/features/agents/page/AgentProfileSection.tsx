import type { ComponentProps } from "react";
import type { AgentProfile } from "@/shared/schemas";
import type { GlobalAiConversation } from "@/features/global-search/types";
import { MistyModelPicker } from "@/features/global-search/MistyModelPicker";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { Button } from "@/shared/ui";
import { AgentAvatar } from "../components/AgentAvatar";
import { AgentEditor } from "../components/AgentEditor";

/** The panel's profile section: the agent editor and, mid-conversation, its model. */
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
          <MistyModelPicker
            inline
            conversationId={conversation.id}
            modelId={conversation.modelId}
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

/** The greeting an agent shows before its first message. */
export function AgentWelcome({
  profile,
  onCustomize,
}: {
  profile: AgentProfile;
  onCustomize(): void;
}) {
  return (
    <div className="agent-welcome">
      <AgentAvatar agent={profile} large />
      <h1>Hi, I’m {profile.name}.</h1>
      <p>{profile.description || "What would you like to work on?"}</p>
      <Button variant="outline" size="sm" onClick={onCustomize}>
        Customize agent
      </Button>
    </div>
  );
}
