import { UserRound, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { cn, IconButton, Skeleton, Surface, Text, windowToolbarClass } from "@misty/ui";
import { useTitlePending } from "../conversations/state/conversation_titles";
import { AgentConversationActions } from "../conversations/view/AgentConversationActions";
import { AgentAvatar } from "../personal/AgentAvatar";
import { AgentIdentity } from "../personal/AgentIdentity";
import { useContextPanel } from "../context-panel/context_panel_store";
import { useRailShown } from "../context-panel/rail_layout_store";

export function ChatTitle({
  conversation,
  agent,
}: {
  conversation?: { id: string; title?: string };
  agent?: AgentProfile;
}) {
  const titlePending = useTitlePending(conversation);
  if (titlePending)
    return (
      <span className="min-w-0 flex-1" aria-busy>
        <Skeleton className="inline-block h-[0.75em] w-[min(--spacing(36),70%)] rounded-full align-middle" />
        <span className="sr-only">Naming this conversation</span>
      </span>
    );
  return (
    <Text as="h1" size="control" weight="semibold" className="min-w-0 flex-1">
      {agent?.name ? `${agent.name} ` : null}
      {agent?.name ? (
        <Text bare tone="muted" weight="regular">
          {conversation ? conversation.title || "Untitled conversation" : "New chat"}
        </Text>
      ) : conversation ? (
        conversation.title || "Untitled conversation"
      ) : (
        "New chat"
      )}
    </Text>
  );
}

export function ChatHeaderButtons() {
  const profileOpen = useContextPanel((state) => state.tab === "profile");
  const railShown = useRailShown((state) => state.value);
  return (
    <div role="toolbar" aria-label="Chat actions" className="flex shrink-0 items-center gap-1">
      <IconButton
        label="Profile"
        variant="quiet"
        aria-pressed={profileOpen}
        onClick={() => useContextPanel.getState().toggle("profile")}
      >
        <UserRound />
      </IconButton>
      <IconButton
        label="Tools"
        variant="quiet"
        aria-pressed={railShown}
        onClick={() => useRailShown.getState().set(!railShown)}
      >
        <Wrench />
      </IconButton>
    </div>
  );
}

const headingAvatarClass = "[&_.agent-avatar]:size-8! [&_.agent-avatar]:text-control!";

export function AgentConversationHeading({
  conversation,
  agent,
  disabled,
  actions,
  panelPicker,
}: {
  conversation?: { id: string; title?: string };
  agent?: AgentProfile;
  disabled: boolean;
  actions?: ReactNode;
  panelPicker?: ReactNode;
}) {
  return (
    <Surface
      as="header"
      tone="workspace"
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
        <AgentIdentity
          agent={agent}
          className={cn(
            "inline-flex min-w-0 max-w-[60%] flex-[0_1_auto] items-center gap-1.5",
            headingAvatarClass,
          )}
        />
      )}
      {panelPicker}
      <div className="ml-auto flex flex-none items-center justify-end [&>*]:shrink-0">
        {conversation && (
          <AgentConversationActions conversation={conversation} disabled={disabled} />
        )}
        {actions}
      </div>
    </Surface>
  );
}
