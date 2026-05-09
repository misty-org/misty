import { spaceSlackApi } from "@/api/integrations/slack";
import type { SpaceSlackLink } from "@/api/spaces/dto/interfaces/connections/slack";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { errorText } from "@/shared/lib/format";
import { useCallback, useEffect, useState } from "react";

export function useSlackPublish(
  spaceId: string,
  conversationId: string | undefined,
  currentUserId: string | undefined,
  onPublished?: (message: SpaceMessage) => void,
) {
  const [links, setLinks] = useState<SpaceSlackLink[]>([]);
  const [publishingMessageId, setPublishingMessageId] = useState("");
  const [error, setError] = useState("");
  const link = links.find((item) => item.conversation_id === conversationId) ?? null;

  useEffect(() => {
    let active = true;
    spaceSlackApi
      .links(spaceId)
      .then((result) => active && setLinks(result.links))
      .catch(() => active && setLinks([]));
    return () => {
      active = false;
    };
  }, [spaceId]);

  const publish = useCallback(
    async (message: SpaceMessage, threadTs = "") => {
      if (!link || publishingMessageId) return undefined;
      setPublishingMessageId(message.id);
      setError("");
      try {
        const result = await spaceSlackApi.publishMessage(spaceId, link.id, message.id, threadTs);
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

  const canPublish = (message: SpaceMessage) =>
    Boolean(
      link &&
      link.status !== "disabled" &&
      link.direction !== "inbound" &&
      link.conversation_id === conversationId &&
      message.sender_kind === "person" &&
      message.sender_user_id === currentUserId &&
      (!message.origin?.system || message.origin.system === "misty"),
    );

  return { link, publish, canPublish, publishingMessageId, error };
}
