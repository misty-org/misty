import { Bell, BellOff, MessagesSquare, Users, type LucideIcon } from "lucide-react";
import { IconButton, IndicatorDot } from "@misty/ui";
import { setMuted, useMessageNotices } from "@/shared/lib/messageNotices";
import { useChatSidePanel } from "../chatSidePanelStore";
import { useThreadsUnread } from "../hooks/useThreadsUnread";
import { useChatSidebarPreferences } from "../sidebar/chatSidebarPreferences";
import { PinnedMessagesButton } from "./PinnedMessagesButton";

/**
 * Threads and Notifications for one chat: what their buttons and menu rows show and do. A DM
 * keeps them in its ⋯ menu (`ChatBarButtons` with `folded`), a channel as buttons in its bar.
 * Opening Threads closes the search (`onPanel`), since they share its place.
 */
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

/**
 * The chat's own buttons in its bar, as Discord keeps a channel's, in one order for every chat:
 * Threads, Notifications, Pinned, then Members. They stay in view beside the search and never
 * fold. Threads marks replies the person hasn't read. Notifications mutes this one chat on this
 * device (`muteId`), and Members shows or hides the member list. Opening Threads or Members closes
 * the search (`onPanel`), since they share its place. A DM is `folded`: Threads and Notifications
 * live in its ⋯ menu (`useChatBarMenu`), and its side panel is named `sideLabel` with `SideIcon`
 * (Profile for one person).
 */
export function ChatBarButtons(props: {
  spaceId: string;
  conversationId?: string;
  /** What the bell mutes: `chatMuteId` for a Space's channel, the DM's id for a DM. */
  muteId: string;
  /** A message search is showing in the member list's place. */
  searching: boolean;
  /** Leave out Members where the chat has no member list. */
  members?: boolean;
  /** Threads and Notifications are in the caller's ⋯ menu instead. */
  folded?: boolean;
  /** What the side panel is, when it isn't the member list: "Profile" beside a DM. */
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
