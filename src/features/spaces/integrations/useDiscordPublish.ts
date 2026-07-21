import { useCallback, useEffect, useState } from "react";

import { errorText } from "@/lib/format";
import { spaceDiscordApi } from "@/stores/spaces/useSpaceDiscordStore";
import { shouldPublishToDiscord } from "@/features/spaces/integrations/discordMessageMapping";
import type { SpaceDiscordLink } from "@/models/interfaces/features/spaces/integrations/discord";
import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";

/**
 * Publishing a Misty message to Discord, one explicit action at a time.
 *
 * Sending in Misty never mirrors automatically: an outward write leaves the
 * team's workspace, so it stays a deliberate per-message choice the transcript
 * then records via `origin.publish_state`.
 */
export function useDiscordPublish(
  spaceId: string,
  conversationId: string | undefined,
  onPublished?: (message: SpaceMessage) => void,
) {
  const [link, setLink] = useState<SpaceDiscordLink | null>(null);
  const [publishingMessageId, setPublishingMessageId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    spaceDiscordApi
      .link(spaceId)
      .then((result) => {
        if (active) setLink(result.link);
      })
      .catch(() => {
        // A Space with no Discord link is the normal case, not an error state.
        if (active) setLink(null);
      });
    return () => {
      active = false;
    };
  }, [spaceId]);

  const publish = useCallback(
    async (message: SpaceMessage) => {
      if (!link || publishingMessageId) return undefined;
      setPublishingMessageId(message.id);
      setError("");
      try {
        const result = await spaceDiscordApi.publishMessage(spaceId, link.id, message.id);
        // The server returns the message with its updated publish state, so the
        // transcript reflects the real outcome rather than an optimistic guess.
        onPublished?.(result.message);
        return result.message;
      } catch (reason) {
        setError(errorText(reason));
        return undefined;
      } finally {
        setPublishingMessageId("");
      }
    },
    [link, onPublished, publishingMessageId, spaceId],
  );

  /**
   * The action is offered only on the conversation this Space actually mirrors,
   * and only for messages the mapping rules would accept.
   */
  const canPublish = (message: SpaceMessage) =>
    Boolean(link) &&
    link?.status !== "disabled" &&
    link?.conversation_id === (conversationId ?? link?.conversation_id) &&
    shouldPublishToDiscord(message, { direction: link?.direction ?? "two_way" });

  return { link, publish, canPublish, publishingMessageId, error, clearError: () => setError("") };
}
