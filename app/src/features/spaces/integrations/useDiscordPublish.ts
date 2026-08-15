import { useCallback, useEffect, useState } from "react";

import { spaceDiscordApi } from "@/api/integrations/discord";
import type { SpaceDiscordLink } from "@/api/spaces/dto/interfaces/connections/discord";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { errorText } from "@/shared/lib/format";
import { shouldPublishToDiscord } from "./discordMessageMapping";

/**
 * Publishing a Misty message to its linked Discord channel. New messages in a
 * two-way conversation call this automatically; the same method powers a
 * deliberate retry when Discord reports a failure.
 */
export function useDiscordPublish(
  spaceId: string,
  conversationId: string | undefined,
  onPublished?: (message: SpaceMessage) => void,
) {
  const [links, setLinks] = useState<SpaceDiscordLink[]>([]);
  const link = links.find((item) => item.conversation_id === conversationId) ?? null;
  const [publishingMessageId, setPublishingMessageId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    spaceDiscordApi
      .links(spaceId)
      .then((result) => {
        if (active) setLinks(result.links);
      })
      .catch(() => {
        // A Space with no Discord link is the normal case, not an error state.
        if (active) setLinks([]);
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
