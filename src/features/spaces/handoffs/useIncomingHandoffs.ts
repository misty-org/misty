import { useEffect, useMemo, useState } from "react";
import { useUserStore } from "@/features/account/core";
import { spacesApi } from "../api/api";
import type { SpaceMessage } from "../api/dto/entities";
import { useSpacesStore } from "../list/useSpacesStore";
import { useHandledHandoffs } from "./handledHandoffs";
import { incomingHandoffs, pendingHandoffs, type IncomingHandoff } from "./spacePosts";

const noMessages: SpaceMessage[] = [];

/** The latest messages of every direct message this person has in a Space. */
async function directMessages(spaceId: string): Promise<SpaceMessage[]> {
  const { conversations } = await spacesApi.conversations(spaceId);
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
  const [direct, setDirect] = useState<{ scope: string; messages: SpaceMessage[] }>();
  const scope = `${me}:${spaceId}`;

  useEffect(() => {
    if (!me || referenceOnly) return;
    let live = true;
    let timer = 0;
    const load = () =>
      void directMessages(spaceId)
        .then((messages) => live && setDirect({ scope, messages }))
        // Offline or refused: show what the main chat holds instead of a skeleton forever.
        .catch(() => live && setDirect((known) => known ?? { scope, messages: noMessages }));
    load();
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string; space_id?: string }>).detail;
      if ((detail?.spaceId ?? detail?.space_id) !== spaceId) return;
      // A burst of messages is one reload.
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 500);
    };
    window.addEventListener("misty:space-message-event", changed);
    window.addEventListener("misty:space-conversation-event", changed);
    return () => {
      live = false;
      window.clearTimeout(timer);
      window.removeEventListener("misty:space-message-event", changed);
      window.removeEventListener("misty:space-conversation-event", changed);
    };
  }, [me, referenceOnly, scope, spaceId]);

  const directNow = direct?.scope === scope ? direct.messages : undefined;
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
