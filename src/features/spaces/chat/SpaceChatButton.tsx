import { useNavigate } from "react-router-dom";
import { IconButton, IndicatorDot, spaceIcons } from "@misty/ui";
import { preloadSpaceSection } from "../overview/SpaceSectionView";
import { spaceChatPath } from "./chatRoute";
import { useSpaceConversationList, useSpaceEveryoneUnread } from "./spaceConversationsResource";

/**
 * The way into the Space's chat from its home: one icon, no label, with a dot while anything in
 * its channels or direct messages is unread.
 */
export function SpaceChatButton({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const everyone = useSpaceEveryoneUnread(spaceId);
  const conversations = useSpaceConversationList(spaceId).data ?? [];
  const unread = everyone + conversations.reduce((sum, item) => sum + (item.unread_count ?? 0), 0);
  const Icon = spaceIcons.chat;
  return (
    <span className="relative inline-flex" data-tour="space-chat-button">
      <IconButton
        label={unread ? `Chat, ${unread >= 100 ? "99+" : unread} unread` : "Chat"}
        onPointerEnter={() => void preloadSpaceSection("chat").catch(() => undefined)}
        onClick={() => navigate(spaceChatPath(spaceId))}
      >
        <Icon />
      </IconButton>
      {unread ? <IndicatorDot className="top-1 right-1 bottom-auto" /> : null}
    </span>
  );
}
