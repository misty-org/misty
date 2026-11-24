import { UserRound, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { ChannelHeader, cn, FramedBar, windowToolbarClass } from "@misty/ui";
import { useTitlePending } from "../conversations/state/conversation_titles";
import { AgentConversationActions } from "../conversations/view/AgentConversationActions";
import { AgentAvatar } from "../personal/AgentAvatar";
import { AgentIdentity } from "../personal/AgentIdentity";
import { useContextPanel } from "../context-panel/context_panel_store";
import { useRailShown } from "../context-panel/rail_layout_store";

export function AgentStudioBar({
  conversation,
  agent,
}: {
  conversation?: { id: string; title?: string };
  agent?: AgentProfile;
}) {
  const titlePending = useTitlePending(conversation);
  const profileOpen = useContextPanel((state) => state.tab === "profile");
  const railShown = useRailShown((state) => state.value);
  const topic = titlePending
    ? undefined
    : conversation
      ? conversation.title || "Untitled thread"
      : "New thread";
  return (
    <ChannelHeader
      leading={<AgentAvatar agent={agent} face />}
      name={agent?.name ?? "Agent"}
      topic={topic}
      actions={[
        {
          id: "profile",
          icon: UserRound,
          label: "Profile",
          priority: 2,
          pressed: profileOpen,
          onSelect: () => useContextPanel.getState().toggle("profile"),
        },
        {
          id: "tools",
          icon: Wrench,
          label: "Tools",
          priority: 1,
          pressed: railShown,
          onSelect: () => useRailShown.getState().set(!railShown),
        },
      ]}
    />
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
    <FramedBar
      className={cn("agent-conversation-heading", windowToolbarClass)}
      data-window-toolbar=""
      data-tauri-drag-region=""
      data-misty-window-titlebar-region="true"
      start={
        <>
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
        </>
      }
    >
      {conversation || actions ? (
        <div className="flex flex-none items-center justify-end [&>*]:shrink-0">
          {conversation && (
            <AgentConversationActions conversation={conversation} disabled={disabled} />
          )}
          {actions}
        </div>
      ) : null}
    </FramedBar>
  );
}
