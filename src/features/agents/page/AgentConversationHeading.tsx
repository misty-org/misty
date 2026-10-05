import type { ComponentProps, Ref } from "react";
import { PanelRight, Plus, X } from "lucide-react";
import { IconButton, Input } from "@/shared/ui";
import { AgentConversationActions } from "../components/AgentConversationActions";
import { AgentSwitcher } from "../components/AgentSwitcher";

type SwitcherProps = ComponentProps<typeof AgentSwitcher>;

/**
 * The conversation title bar. Inside the agent workspace the sidebar owns identity and
 * New task, so the bar carries only the conversation's title, its actions and the task
 * panel toggle. Outside it (loading, or picking a recipient) the bar keeps the switcher.
 */
export function AgentConversationHeading({
  workspace = false,
  newChat,
  conversation,
  recipientSearch,
  recipientInputRef,
  switcher,
  disabled,
  panelDisabled,
  panelVisible,
  onRecipientSearch,
  onCloseNewChat,
  onNewChat,
  onTogglePanel,
  onFloat,
}: {
  workspace?: boolean;
  newChat: boolean;
  conversation?: { id: string; title?: string };
  recipientSearch: string;
  recipientInputRef: Ref<HTMLInputElement>;
  switcher: SwitcherProps;
  disabled: boolean;
  panelDisabled: boolean;
  panelVisible: boolean;
  onRecipientSearch(value: string): void;
  onCloseNewChat(): void;
  onNewChat(): void;
  onTogglePanel(): void;
  onFloat?(): void;
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
        <div className="agent-heading-end">
          {conversation && (
            <AgentConversationActions
              conversation={conversation}
              disabled={disabled}
              onFloat={onFloat}
            />
          )}
          <IconButton
            label="Show task panel"
            disabled={panelDisabled}
            data-agent-navigation-control
            aria-pressed={panelVisible}
            onClick={onTogglePanel}
          >
            <PanelRight size={16} />
          </IconButton>
        </div>
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
            <IconButton
              label="Show task panel"
              disabled={panelDisabled}
              data-agent-navigation-control
              aria-pressed={panelVisible}
              onClick={onTogglePanel}
            >
              <PanelRight size={16} />
            </IconButton>
          </div>
        </>
      )}
    </header>
  );
}
