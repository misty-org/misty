import { Bell, BellOff, MessagesSquare, Pin, Users, type LucideIcon } from "lucide-react";
import { IconButton, IndicatorDot, type ActionBarItem } from "@misty/ui";
import { setMuted, useMessageNotices } from "@/shared/lib/message_notices";
import { useChatSidePanel } from "../chat_side_panel_store";
import { useThreadsUnread } from "../hooks/use_threads_unread";
import { useChatSidebarPreferences } from "../sidebar/chat_sidebar_preferences";

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

export function useChatBarActions(props: {
  spaceId: string;
  conversationId?: string;
  muteId: string;
  searching: boolean;
  members?: boolean;
  folded?: boolean;
  sideLabel?: string;
  SideIcon?: LucideIcon;
  onPanel(): void;
}): ActionBarItem[] {
  const menu = useChatBarMenu(props);
  const pinnedOpen = useChatSidePanel((panel) => panel.pinnedOpen);
  const membersShown = !useChatSidebarPreferences((state) => state.value.hideMembers);
  const saveMembers = useChatSidebarPreferences((state) => state.set);
  const SideIcon = props.SideIcon ?? Users;
  const sideLabel = props.sideLabel ?? "Members";

  const membersPressed = membersShown && !props.searching && !menu.threadsOpen && !pinnedOpen;
  const toggleMembers = () => {
    props.onPanel();
    useChatSidePanel.getState().reset();
    saveMembers((current) => ({ ...current, hideMembers: membersPressed }));
  };
  const togglePinned = () => {
    props.onPanel();
    const panel = useChatSidePanel.getState();
    if (panel.pinnedOpen) panel.closePinned();
    else panel.openPinned();
  };
  const items: ActionBarItem[] = [];
  if (!props.folded)
    items.push(
      {
        id: "threads",
        icon: MessagesSquare,
        label: menu.threadsLabel,
        priority: 9,
        pressed: menu.threadsOpen,
        onSelect: menu.toggleThreads,
        render: () => (
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
        ),
      },
      {
        id: "mute",
        icon: menu.MuteIcon,
        label: menu.muteLabel,
        priority: 2,
        pressed: menu.muted,
        onSelect: menu.toggleMute,
      },
    );
  items.push({
    id: "pinned",
    icon: Pin,
    label: "Pinned",
    priority: 3,
    pressed: pinnedOpen,
    onSelect: togglePinned,
  });
  if (props.members !== false)
    items.push({
      id: "members",
      icon: SideIcon,
      label: sideLabel,
      priority: 5,
      pressed: membersPressed,
      onSelect: toggleMembers,
    });
  return items;
}
