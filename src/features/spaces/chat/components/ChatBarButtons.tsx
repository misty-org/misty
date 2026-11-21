import { Bell, BellOff, MessagesSquare, Users } from "lucide-react";
import { IconButton, IndicatorDot } from "@misty/ui";
import { setMuted, useMessageNotices } from "@/shared/lib/messageNotices";
import { useChatSidePanel } from "../chatSidePanelStore";
import { useThreadsUnread } from "../hooks/useThreadsUnread";
import { useChatSidebarPreferences } from "../sidebar/chatSidebarPreferences";
import { PinnedMessagesButton } from "./PinnedMessagesButton";

/**
 * The chat's own buttons in its bar, as Discord keeps a channel's, in one order for every chat:
 * Threads, Notifications, Pinned, then Members. They stay in view beside the search and never
 * fold. Threads marks replies the person hasn't read. Notifications mutes this one chat on this
 * device (`muteId`), and Members shows or hides the member list. Opening Threads or Members closes
 * the search (`onPanel`), since they share its place.
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
  onPanel(): void;
}) {
  const { spaceId, conversationId = "", muteId } = props;
  const threadsUnread = useThreadsUnread(spaceId, conversationId);
  const threadOpen = useChatSidePanel((panel) => Boolean(panel.threadRootId));
  const threadsListOpen = useChatSidePanel((panel) => panel.threadsListOpen);
  const membersShown = !useChatSidebarPreferences((state) => state.value.hideMembers);
  const saveMembers = useChatSidebarPreferences((state) => state.set);
  const muted = useMessageNotices((state) => state.value.muted.includes(muteId));

  const threadsLabel = threadsUnread > 0 ? `Threads, ${threadsUnread} unread` : "Threads";
  const toggleThreads = () => {
    props.onPanel();
    const panel = useChatSidePanel.getState();
    if (panel.threadsListOpen || panel.threadRootId) panel.reset();
    else panel.openThreadsList();
  };
  const toggleMembers = () => {
    props.onPanel();
    useChatSidePanel.getState().reset();
    saveMembers((current) => ({ ...current, hideMembers: membersShown }));
  };
  return (
    <>
      <span className="relative inline-flex">
        <IconButton
          label={threadsLabel}
          variant="quiet"
          aria-pressed={threadsListOpen || threadOpen}
          onClick={toggleThreads}
        >
          <MessagesSquare />
        </IconButton>
        {threadsUnread > 0 ? <IndicatorDot /> : null}
      </span>
      <IconButton
        label={muted ? "Unmute notifications" : "Mute notifications"}
        variant="quiet"
        aria-pressed={muted}
        onClick={() => setMuted(muteId, !muted)}
      >
        {muted ? <BellOff /> : <Bell />}
      </IconButton>
      <PinnedMessagesButton spaceId={spaceId} conversationId={conversationId} />
      {props.members === false ? null : (
        <IconButton
          label="Members"
          variant="quiet"
          aria-pressed={membersShown && !props.searching && !threadOpen && !threadsListOpen}
          onClick={toggleMembers}
        >
          <Users />
        </IconButton>
      )}
    </>
  );
}
