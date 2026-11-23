import { Bell, BellOff, MessagesSquare, Users, type LucideIcon } from "lucide-react";
import { IconButton, IndicatorDot } from "@misty/ui";
import { setMuted, useMessageNotices } from "@/shared/lib/message_notices";
import { useChatSidePanel } from "../chat_side_panel_store";
import { useThreadsUnread } from "../hooks/use_threads_unread";
import { useChatSidebarPreferences } from "../sidebar/chat_sidebar_preferences";
import { PinnedMessagesButton } from "./PinnedMessagesButton";

export function useChatBarMenu(props: {
  spaceId: string;
  conversationId?: string;
  muteId: string;
  onPanel(): void;
}) {
  const { spaceId, conversationId = "", muteId, onPanel } = props;
  const threadsUnread = useThreadsUnread(spaceId, conversationId);
  const threadOpen = useChatSidePanel((panel) => Boolean(panel.threadRootId));
  const threadsListOpen = useChatSidePanel((panel) => panel.threadsListOpen);
  const muted = useMessageNotices((state) => state.value.muted.includes(muteId));
  return {
    threadsUnread,
    threadsLabel: threadsUnread > 0 ? `Threads, ${threadsUnread} unread` : "Threads",
    threadsOpen: threadsListOpen || threadOpen,
    toggleThreads: () => {
      onPanel();
      const panel = useChatSidePanel.getState();
      if (panel.threadsListOpen || panel.threadRootId) panel.reset();
      else panel.openThreadsList();
    },
    muted,
    muteLabel: muted ? "Unmute notifications" : "Mute notifications",
    MuteIcon: muted ? BellOff : Bell,
    toggleMute: () => setMuted(muteId, !muted),
  };
}

export function ChatBarButtons(props: {
  spaceId: string;
  conversationId?: string;
  muteId: string;
  searching: boolean;
  members?: boolean;
  folded?: boolean;
  sideLabel?: string;
  SideIcon?: LucideIcon;
  onPanel(): void;
}) {
  const { spaceId, conversationId = "" } = props;
  const menu = useChatBarMenu(props);
  const membersShown = !useChatSidebarPreferences((state) => state.value.hideMembers);
  const saveMembers = useChatSidebarPreferences((state) => state.set);
  const SideIcon = props.SideIcon ?? Users;

  const toggleMembers = () => {
    props.onPanel();
    useChatSidePanel.getState().reset();
    saveMembers((current) => ({ ...current, hideMembers: membersShown }));
  };
  return (
    <>
      {props.folded ? null : (
        <>
          <span className="relative inline-flex">
            <IconButton
              label={menu.threadsLabel}
              variant="quiet"
              aria-pressed={menu.threadsOpen}
              onClick={menu.toggleThreads}
            >
              <MessagesSquare />
            </IconButton>
            {menu.threadsUnread > 0 ? <IndicatorDot /> : null}
          </span>
          <IconButton
            label={menu.muteLabel}
            variant="quiet"
            aria-pressed={menu.muted}
            onClick={menu.toggleMute}
          >
            <menu.MuteIcon />
          </IconButton>
        </>
      )}
      <PinnedMessagesButton spaceId={spaceId} conversationId={conversationId} />
      {props.members === false ? null : (
        <IconButton
          label={props.sideLabel ?? "Members"}
          variant="quiet"
          aria-pressed={membersShown && !props.searching && !menu.threadsOpen}
          onClick={toggleMembers}
        >
          <SideIcon />
        </IconButton>
      )}
    </>
  );
}
