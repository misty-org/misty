import type { ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { cn, Skeleton, Surface, Text, windowToolbarClass } from "@/shared/ui";
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
        {/* A new conversation's name while its separate title call runs. */}
        <Skeleton className="inline-block h-[0.75em] w-[min(9rem,70%)] rounded-full align-middle" />
        <span className="sr-only">Naming this conversation</span>
      </span>
    );
  return (
    <Text as="h1" size="control" weight="semibold" className="min-w-0 flex-1">
      {conversation ? conversation.title || "Untitled conversation" : "New chat"}
    </Text>
  );
}

/** The header's avatar is a step smaller than the agent's own (AgentAvatar sizes it). */
const headingAvatarClass = "[&_.agent-avatar]:size-8! [&_.agent-avatar]:text-control!";

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
    // On the window's own surface, so the conversation scrolls under it unseen.
    <Surface
      as="header"
      tone="workspace"
      // A page header's 16px sides, so the title lines up with the tab row's first tab above.
      className={cn(
        "agent-conversation-heading flex h-13.5 shrink-0 items-center justify-between gap-2 px-4",
        windowToolbarClass,
      )}
      data-window-toolbar
      data-tauri-drag-region
      data-misty-window-titlebar-region="true"
    >
      {panelPicker ? (
        <span className={cn("inline-flex flex-none", headingAvatarClass)}>
          <AgentAvatar agent={agent} />
        </span>
      ) : (
        // Sized to its avatar and name; only a long name fades.
        <AgentIdentity
          agent={agent}
          className={cn(
            "inline-flex min-w-0 max-w-[60%] flex-[0_1_auto] items-center gap-1.5",
            headingAvatarClass,
          )}
        />
      )}
      {panelPicker}
      {/* The buttons keep their size; a narrow header squeezes the title, never them. */}
      <div className="ml-auto flex flex-none items-center justify-end [&>*]:shrink-0">
        {conversation && (
          <AgentConversationActions conversation={conversation} disabled={disabled} />
        )}
        {actions}
      </div>
    </Surface>
  );
}
