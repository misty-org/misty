import type { ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { Skeleton, Text } from "@/shared/ui";
import { useTitlePending } from "../conversations/state/conversationTitles";
import { AgentConversationActions } from "../conversations/view/AgentConversationActions";
import { AgentAvatar } from "../personal/AgentAvatar";
import { AgentIdentity } from "../personal/AgentIdentity";

/**
 * The open chat's name, as its title call made it: a skeleton while that call runs, "New chat"
 * before the first message. The tab above names the agent; the chat itself shows only this.
 */
export function ChatTitle({ conversation }: { conversation?: { id: string; title?: string } }) {
  const titlePending = useTitlePending(conversation);
  if (titlePending)
    return (
      <span className="min-w-0 flex-1" aria-busy>
        <Skeleton className="agent-title-skeleton" />
        <span className="sr-only">Naming this conversation</span>
      </span>
    );
  return (
    <Text as="h1" size="control" weight="semibold" className="min-w-0 flex-1">
      {conversation ? conversation.title || "Untitled conversation" : "New chat"}
    </Text>
  );
}

/**
 * The conversation title bar outside the agent workspace (loading): it names the chat's agent and
 * keeps the conversation's actions. Inside the workspace the studio bar shows `ChatTitle` instead.
 * It never switches the agent.
 */
export function AgentConversationHeading({
  conversation,
  agent,
  disabled,
  actions,
  panelPicker,
}: {
  conversation?: { id: string; title?: string };
  /** The chat's agent. */
  agent?: AgentProfile;
  disabled: boolean;
  /** Extra controls after New chat, for a host that is not the Agents page. */
  actions?: ReactNode;
  /** The Misty panel's conversation picker. Given, the bar shows only the agent's avatar. */
  panelPicker?: ReactNode;
}) {
  return (
    <header
      className="agent-conversation-heading"
      data-window-toolbar
      data-tauri-drag-region
      data-misty-window-titlebar-region="true"
    >
      {panelPicker ? (
        <span className="agent-heading-avatar">
          <AgentAvatar agent={agent} />
        </span>
      ) : (
        <AgentIdentity agent={agent} className="agent-heading-identity" />
      )}
      {panelPicker}
      <div className="agent-heading-end">
        {conversation && (
          <AgentConversationActions conversation={conversation} disabled={disabled} />
        )}
        {actions}
      </div>
    </header>
  );
}
