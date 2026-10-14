import type { ComponentProps, ReactNode, Ref } from "react";
import { Plus, X } from "lucide-react";
import { IconButton, Input, Skeleton, Spinner } from "@/shared/ui";
import { useTitlePending } from "@/features/misty/conversationTitles";
import { AgentConversationActions } from "../components/AgentConversationActions";
import { AgentSwitcher } from "../components/AgentSwitcher";

type SwitcherProps = ComponentProps<typeof AgentSwitcher>;

/**
 * The conversation title bar. Inside the agent workspace the sidebar owns identity and
 * New task, so the bar carries the conversation's title and a quiet Working status while
 * a task runs; rename and delete live on its Recents row. Outside it (loading, or picking
 * a recipient) the bar keeps the switcher and the conversation's actions.
 */
export function AgentConversationHeading({
  workspace = false,
  newChat,
  conversation,
  recipientSearch,
  recipientInputRef,
  switcher,
  disabled,
  onRecipientSearch,
  onCloseNewChat,
  onNewChat,
  working = false,
  actions,
}: {
  workspace?: boolean;
  newChat: boolean;
  conversation?: { id: string; title?: string };
  recipientSearch: string;
  recipientInputRef: Ref<HTMLInputElement>;
  switcher: SwitcherProps;
  disabled: boolean;
  onRecipientSearch(value: string): void;
  onCloseNewChat(): void;
  onNewChat(): void;
  working?: boolean;
  /** Extra controls after New chat, for a host that is not the Agents page. */
  actions?: ReactNode;
}) {
  const titlePending = useTitlePending(conversation);
  if (workspace && !newChat)
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
            Working
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
      {newChat ? (
        <>
          <label className="agent-recipient-input">
            <span>To:</span>
            <Input
              ref={recipientInputRef}
              variant="bare"
              autoFocus
              aria-label="Search or create agents"
              placeholder="Search or create agents"
              value={recipientSearch}
              onChange={(e) => onRecipientSearch(e.target.value)}
            />
          </label>
          <IconButton label="Close new chat" onClick={onCloseNewChat}>
            <X size={16} />
          </IconButton>
        </>
      ) : (
        <>
          <AgentSwitcher {...switcher} />
          <div className="agent-heading-end">
            {conversation && (
              <AgentConversationActions conversation={conversation} disabled={disabled} />
            )}
            <IconButton
              label="New chat"
              data-agent-navigation-control
              disabled={disabled}
              onClick={onNewChat}
            >
              <Plus />
            </IconButton>
            {actions}
          </div>
        </>
      )}
    </header>
  );
}
