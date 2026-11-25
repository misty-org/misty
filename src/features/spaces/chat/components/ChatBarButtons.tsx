import { useState, type ReactNode } from "react";
import { Bell, BellOff, MessagesSquare, Pin, Users, type LucideIcon } from "lucide-react";
import { IconButton, IndicatorDot, SearchField, type ActionBarItem } from "@misty/ui";
import { chatCallItems, chatMoreItem, type ChatBarCalls } from "@/shared/hooks/ChatBarItems";
import { useMuted } from "@/shared/lib/message_notices";
import { useChatSidePanel } from "../chat_side_panel_store";
import { useThreadsUnread } from "../hooks/use_threads_unread";
import { useChatSidebarPreferences } from "../sidebar/chat_sidebar_preferences";

export function useChatBar(props: {
  spaceId: string;
  conversationId?: string;
  muteId: string;
  calls?: ChatBarCalls;
  side?: { label: string; icon: LucideIcon };
  more?: ReactNode;
}) {
  const { spaceId, conversationId = "", muteId } = props;
  const [searchText, setSearchText] = useState("");
  const [searchedText, setSearchedText] = useState("");
  const closeSearch = () => {
    setSearchText("");
    setSearchedText("");
  };

  const threadsUnread = useThreadsUnread(spaceId, conversationId);
  const threadOpen = useChatSidePanel((panel) => Boolean(panel.threadRootId));
  const threadsListOpen = useChatSidePanel((panel) => panel.threadsListOpen);
  const pinnedOpen = useChatSidePanel((panel) => panel.pinnedOpen);
  const membersShown = !useChatSidebarPreferences((state) => state.value.hideMembers);
  const saveMembers = useChatSidebarPreferences((state) => state.set);
  const mute = useMuted(spaceId, muteId);

  const threadsOpen = threadsListOpen || threadOpen;
  const threadsLabel = threadsUnread > 0 ? `Threads, ${threadsUnread} unread` : "Threads";
  const toggleThreads = () => {
    closeSearch();
    const panel = useChatSidePanel.getState();
    if (panel.threadsListOpen || panel.threadRootId) panel.reset();
    else panel.openThreadsList();
  };
  const togglePinned = () => {
    closeSearch();
    const panel = useChatSidePanel.getState();
    if (panel.pinnedOpen) panel.closePinned();
    else panel.openPinned();
  };
  const sidePressed = membersShown && !searchedText && !threadsOpen && !pinnedOpen;
  const toggleSide = () => {
    closeSearch();
    useChatSidePanel.getState().reset();
    saveMembers((current) => ({ ...current, hideMembers: sidePressed }));
  };

  const actions: ActionBarItem[] = chatCallItems(props.calls);
  actions.push(
    {
      id: "threads",
      icon: MessagesSquare,
      label: threadsLabel,
      priority: 9,
      pressed: threadsOpen,
      onSelect: toggleThreads,
      render: () => (
        <span className="relative inline-flex">
          <IconButton
            label={threadsLabel}
            variant="quiet"
            aria-pressed={threadsOpen}
            onClick={toggleThreads}
          >
            <MessagesSquare />
          </IconButton>
          {threadsUnread > 0 ? <IndicatorDot /> : null}
        </span>
      ),
    },
    {
      id: "mute",
      icon: mute.muted ? BellOff : Bell,
      label: mute.bySpace
        ? "Muted with the Space"
        : mute.muted
          ? "Unmute notifications"
          : "Mute notifications",
      priority: 2,
      pressed: mute.muted,
      disabled: mute.bySpace,
      onSelect: mute.toggle,
    },
    {
      id: "pinned",
      icon: Pin,
      label: "Pinned",
      priority: 3,
      pressed: pinnedOpen,
      onSelect: togglePinned,
    },
    {
      id: "side",
      icon: props.side?.icon ?? Users,
      label: props.side?.label ?? "Members",
      priority: 5,
      pressed: sidePressed,
      onSelect: toggleSide,
    },
  );
  actions.push(...chatMoreItem(props.more));

  const search = (
    <SearchField
      containerClassName="w-56"
      aria-label="Search messages"
      placeholder="Search messages"
      value={searchText}
      onChange={(event) => {
        setSearchText(event.target.value);
        if (!event.target.value) setSearchedText("");
      }}
      onClear={closeSearch}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          setSearchedText(searchText.trim());
        }
      }}
    />
  );

  return { actions, search, searchedText, closeSearch };
}
