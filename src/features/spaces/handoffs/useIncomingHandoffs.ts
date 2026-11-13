import { useEffect, useMemo } from "react";
import { useUserStore } from "@/features/account/core";
import { spacesApi } from "../api/api";
import type { SpaceMessage } from "../api/dto/entities";
import { useSpaceResource } from "../api/spaceResource";
import { reloadSpaceConversations } from "../chat/spaceConversationsResource";
import { useSpacesStore } from "../list/useSpacesStore";
import { useHandledHandoffs } from "./handledHandoffs";
import { incomingHandoffs, pendingHandoffs, type IncomingHandoff } from "./spacePosts";

const noMessages: SpaceMessage[] = [];

/** The latest messages of every direct message this person has in a Space. */
async function directMessages(spaceId: string): Promise<SpaceMessage[]> {
  // The shared conversation list, so the chat sidebar and home page read it once with this.
  const conversations = await reloadSpaceConversations(spaceId);
  const loaded = await Promise.allSettled(
    conversations
      .filter((conversation) => conversation.kind === "dm")
      .map((conversation) => spacesApi.conversationMessages(spaceId, conversation.id)),
  );
  return loaded.flatMap((result) => (result.status === "fulfilled" ? result.value.messages : []));
}

/**
 * The handoffs other members sent this person in a Space that they have not yet given to an
 * agent or dismissed, newest first. `handoffs` is undefined until the first load.
 */
export function useIncomingHandoffs(spaceId: string): {
  handoffs: IncomingHandoff[] | undefined;
  me: string;
} {
  const me = useUserStore((state) => state.me?.id ?? "");
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const mainChat = useSpacesStore((state) => state.messagesBySpace[spaceId]);
  const handled = useHandledHandoffs(me, spaceId);
  // The last copy paints at once on a revisit or relaunch, and a fresh read follows behind it.
  const direct = useSpaceResource(
    me && !referenceOnly ? `/spaces/${encodeURIComponent(spaceId)}/handoffs/direct-messages` : null,
    () => directMessages(spaceId),
  );
  const reloadDirect = direct.reload;

  useEffect(() => {
    if (!me || referenceOnly) return;
    let timer = 0;
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string; space_id?: string }>).detail;
      if ((detail?.spaceId ?? detail?.space_id) !== spaceId) return;
      // A burst of messages is one reload.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reloadDirect(), 500);
    };
    window.addEventListener("misty:space-message-event", changed);
    window.addEventListener("misty:space-conversation-event", changed);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("misty:space-message-event", changed);
      window.removeEventListener("misty:space-conversation-event", changed);
    };
  }, [me, referenceOnly, reloadDirect, spaceId]);

  // Offline or refused with nothing saved: show what the main chat holds instead of a skeleton
  // forever.
  const directNow = direct.data ?? (direct.error ? noMessages : undefined);
  const handoffs = useMemo(() => {
    if (!me || referenceOnly) return [];
    if (!directNow) return undefined;
    return pendingHandoffs(
      [
        ...incomingHandoffs(directNow, me, true),
        ...incomingHandoffs(mainChat ?? noMessages, me, false),
      ],
      handled,
    );
  }, [directNow, handled, mainChat, me, referenceOnly]);
  return { handoffs, me };
}
