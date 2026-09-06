import type { ComponentProps, ReactNode, Ref } from "react";
import { PanelRight, Plus, X } from "lucide-react";
import { Button, IconButton, Input, Spinner } from "@/shared/ui";
import { AgentConversationActions } from "../components/AgentConversationActions";
import { AgentSwitcher } from "../components/AgentSwitcher";

type SwitcherProps = ComponentProps<typeof AgentSwitcher>;

/** The Details panel's controls in the title bar. */
export type AgentDetailsToggle = {
  open: boolean;
  working: boolean;
  onToggle(): void;
  /** Opens Details on the Task section. */
  onTask(): void;
};

/**
 * The conversation title bar. Inside the agent workspace the sidebar owns identity and
 * New task, so the bar carries the conversation's title, a quiet Working status while a
 * task runs, and the Details toggle; rename and delete live on its Recents row. Outside
 * it (loading, or picking a recipient) the bar keeps the switcher and the conversation's
 * actions.
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
  details,
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
  details?: AgentDetailsToggle;
  /** Extra controls after New chat, for a host that is not the Agents page. */
  actions?: ReactNode;
}) {
  if (workspace && !newChat)
    return (
      <header
        className="agent-conversation-heading"
        data-workspace
        data-window-toolbar
        data-tauri-drag-region
        data-misty-window-titlebar-region="true"
      >
        <h1 className="agent-heading-title" title={conversation?.title}>
          {conversation ? conversation.title || "Untitled conversation" : ""}
        </h1>
        {details && (
          <div className="agent-heading-details">
            {details.working && (
              <Button
                variant="chip"
                size="chip"
                className="font-normal"
                title="Show task details"
                onClick={details.onTask}
              >
                <Spinner size="sm" label={false} />
                Working
              </Button>
            )}
            <IconButton
              data-agent-details-toggle
              label={details.open ? "Hide details" : "Show details"}
              aria-pressed={details.open}
              onClick={details.onToggle}
            >
              <PanelRight size={16} />
            </IconButton>
          </div>
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
