import { useNavigate } from "react-router-dom";
import { IconButton, IndicatorDot, spaceIcons } from "@misty/ui";
import { noticesMuted, useMessageNotices } from "@/shared/lib/message_notices";
import { preloadSpaceSection } from "../overview/SpaceSectionView";
import { spaceChatPath } from "./chat_route";
import { useSpaceConversationList, useSpaceEveryoneUnread } from "./space_conversations_resource";

export function SpaceChatButton({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const everyone = useSpaceEveryoneUnread(spaceId);
  const conversations = useSpaceConversationList(spaceId).data ?? [];
  const notices = useMessageNotices((state) => state.value);
  const unread =
    (noticesMuted(notices, spaceId, "") ? 0 : everyone) +
    conversations.reduce(
      (sum, item) => sum + (noticesMuted(notices, spaceId, item.id) ? 0 : (item.unread_count ?? 0)),
      0,
    );
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
