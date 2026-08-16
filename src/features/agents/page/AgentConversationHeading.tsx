import type { ComponentProps, Ref } from "react";
import { ArrowLeft, PanelRight, Plus, X } from "lucide-react";
import { IconButton, Input } from "@/shared/ui";
import { AgentConversationActions } from "../components/AgentConversationActions";
import { AgentSwitcher } from "../components/AgentSwitcher";

type SwitcherProps = ComponentProps<typeof AgentSwitcher>;

/**
 * The conversation title bar: back, the agent switcher, and the panel controls.
 * Inside the agent workspace the sidebar already owns back, identity and New task,
 * so the bar names only the open conversation.
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
  onBack,
  onRecipientSearch,
  onCloseNewChat,
  onNewChat,
  onTogglePanel,
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
  onBack(): void;
  onRecipientSearch(value: string): void;
  onCloseNewChat(): void;
  onNewChat(): void;
  onTogglePanel(): void;
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
            <AgentConversationActions conversation={conversation} disabled={disabled} />
          )}
          <IconButton
            label="Show agent panel"
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
      <div className="agent-heading-start">
        <IconButton label="Back to agents" onClick={onBack}>
          <ArrowLeft size={16} />
        </IconButton>
      </div>
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
              label="Show agent panel"
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
