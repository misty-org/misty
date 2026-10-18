import type { ComponentProps, ReactNode } from "react";
import { Skeleton, Spinner } from "@/shared/ui";
import { useTitlePending } from "@/features/misty/conversationTitles";
import { AgentConversationActions } from "../components/AgentConversationActions";
import { AgentAvatar } from "../components/AgentAvatar";
import { AgentSwitcher } from "../components/AgentSwitcher";

type SwitcherProps = ComponentProps<typeof AgentSwitcher>;

/**
 * The conversation title bar. Inside the agent workspace the sidebar owns identity and
 * New task, so the bar carries the conversation's title and a quiet Working status while
 * a task runs; rename and delete live on its Recents row. Outside it (loading) the bar keeps the switcher and the conversation's actions.
 */
export function AgentConversationHeading({
  workspace = false,
  conversation,
  switcher,
  disabled,
  working = false,
  actions,
  panelPicker,
}: {
  workspace?: boolean;
  conversation?: { id: string; title?: string };
  switcher: SwitcherProps;
  disabled: boolean;
  working?: boolean;
  /** Extra controls after New chat, for a host that is not the Agents page. */
  actions?: ReactNode;
  /** The Misty panel's conversation picker. Given, the switcher shows only the agent's avatar. */
  panelPicker?: ReactNode;
}) {
  const titlePending = useTitlePending(conversation);
  if (workspace)
    return (
      <header
        className="agent-conversation-heading"
        data-workspace
        data-window-toolbar
        data-tauri-drag-region
        data-misty-window-titlebar-region="true"
      >
        <h1
          className="agent-heading-title"
          title={titlePending ? undefined : conversation?.title}
          aria-busy={titlePending || undefined}
        >
          {titlePending ? (
            <>
              <Skeleton className="agent-title-skeleton" />
              <span className="sr-only">Naming this conversation</span>
            </>
          ) : conversation ? (
            conversation.title || "Untitled conversation"
          ) : (
            ""
          )}
        </h1>
        {working && (
          <span className="agent-heading-details" role="status">
            <Spinner size="sm" label={false} />
            <span className="misty-shimmer">Working</span>
          </span>
        )}
      </header>
    );
  return (
    <header
      className="agent-conversation-heading"
      data-window-toolbar
      data-tauri-drag-region
      data-misty-window-titlebar-region="true"
    >
      {panelPicker ? (
        // The panel follows the agent chosen in the navbar pill, so its avatar is not a switch.
        <span className="agent-heading-avatar">
          <AgentAvatar agent={switcher.selectedAgent} />
        </span>
      ) : (
        <AgentSwitcher {...switcher} />
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
