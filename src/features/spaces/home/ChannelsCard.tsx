import { Hash } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUserStore } from "@/features/account/core";
import { conversationPath } from "../chat/chatRoute";
import { conversationName, groupConversations } from "../chat/sidebar/conversationGroups";
import { useSpaceConversations } from "../chat/sidebar/useSpaceConversations";
import { OverviewCard, OverviewEmpty, OverviewRow, OverviewRowsSkeleton } from "./OverviewCard";

/** The most channels the card lists. */
const MAX_ROWS = 4;

/**
 * The Space's channels that have something new, with how many messages wait, the busiest first. With
 * nothing new it says so instead of leaving a hole beside the card next to it.
 */
export function ChannelsCard({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const me = useUserStore((state) => state.me?.id);
  const { conversations, loading, error } = useSpaceConversations(spaceId);
  if (loading)
    return (
      <OverviewCard title="Channels">
        <OverviewRowsSkeleton rows={3} trailing={false} />
      </OverviewCard>
    );
  if (error && !conversations.length) return null;
  const [channels] = groupConversations(conversations);
  const waiting = (channels?.conversations ?? [])
    .filter((conversation) => (conversation.unread_count ?? 0) > 0)
    .sort((left, right) => (right.unread_count ?? 0) - (left.unread_count ?? 0))
    .slice(0, MAX_ROWS);
  return (
    <OverviewCard title="Channels">
      {waiting.length ? (
        waiting.map((conversation) => (
          <OverviewRow
            key={conversation.id}
            kind="schedule"
            leading={<Hash aria-hidden="true" />}
            title={conversationName(conversation, me)}
            detail={`${conversation.unread_count} new ${conversation.unread_count === 1 ? "message" : "messages"}`}
            onOpen={() => navigate(conversationPath(spaceId, conversation))}
          />
        ))
      ) : (
        <OverviewEmpty>No new messages in your channels.</OverviewEmpty>
      )}
    </OverviewCard>
  );
}
