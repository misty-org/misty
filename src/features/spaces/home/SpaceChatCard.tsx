import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PersonAvatar, personTone, shortAgo } from "@/features/agents";
import { useNow } from "@/shared/hooks/useNow";
import { plainText, readSpacePost } from "../handoffs/spacePosts";
import { useSpacesStore } from "../list/useSpacesStore";
import { OverviewCard, OverviewRow, OverviewRowsSkeleton } from "./OverviewCard";

/** How many of the latest messages the card shows. */
const shown = 4;

/**
 * The latest messages in the Space's main chat, newest first: who said it and what. Handoffs and
 * claims have their own panels, and system lines say nothing to read here, so neither shows. Any
 * row opens the chat.
 */
export function SpaceChatCard({ spaceId }: { spaceId: string }) {
  const now = useNow();
  const navigate = useNavigate();
  const messages = useSpacesStore((state) => state.messagesBySpace[spaceId]);
  const readOnly = useSpacesStore((state) => state.referenceOnly);
  // A chat that couldn't be read shows empty rather than a skeleton that never ends.
  const loadFailed = useSpacesStore((state) => Boolean(state.messageErrorsBySpace[spaceId]));

  useEffect(() => {
    const store = useSpacesStore.getState();
    if (!store.messagesBySpace[spaceId] && !store.referenceOnly) void store.loadMessages(spaceId);
  }, [spaceId]);

  const latest = useMemo(
    () =>
      (messages ?? [])
        .filter(
          (message) =>
            !message.conversation_id &&
            message.sender_kind !== "system" &&
            !readSpacePost(message) &&
            plainText(message.content).trim(),
        )
        .slice(-shown)
        .reverse(),
    [messages],
  );

  const openChat = () => navigate(`/spaces/${encodeURIComponent(spaceId)}/chat`);

  const loading = !messages && !readOnly && !loadFailed;
  // No messages: the home leaves the block out; the chat is one of the Space's pages above it.
  if (!loading && !latest.length) return null;
  return (
    <OverviewCard title="Space chat">
      {loading ? (
        <OverviewRowsSkeleton rows={3} />
      ) : (
        latest.map((message) => (
          <OverviewRow
            key={message.id}
            leading={
              <PersonAvatar
                spaceId={spaceId}
                person={{
                  id: message.sender_user_id,
                  name: message.sender_name,
                  tone: personTone(message.sender_user_id),
                }}
              />
            }
            title={plainText(message.content).replace(/\s+/g, " ").trim()}
            detail={message.sender_name}
            trailing={shortAgo(message.created_at, now)}
            onOpen={openChat}
          />
        ))
      )}
    </OverviewCard>
  );
}
