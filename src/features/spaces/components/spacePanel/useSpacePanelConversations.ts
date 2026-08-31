import { spacesApi } from "@/api/spaces/api";
import type { Space, SpaceConversation } from "@/api/spaces/dto/interfaces/types";
import { useEffect, useState } from "react";

/**
 * Group conversations for the active Space, kept in step with realtime events.
 *
 * Conversations are fetched rather than read from the Spaces store because the
 * store only snapshots Space membership, not per-Space conversation lists.
 */
export function useSpacePanelConversations(options: {
  activeSpaceId: string;
  activeSpace: Space | undefined;
  snapshotReady: boolean;
  enabled: boolean;
}) {
  const { activeSpaceId, activeSpace, snapshotReady, enabled } = options;
  const [conversations, setConversations] = useState<SpaceConversation[]>([]);
  const readable = activeSpace?.permissions?.["messages.read"] !== false;

  useEffect(() => {
    if (!enabled || !snapshotReady || !activeSpaceId || !activeSpace || !readable) {
      setConversations([]);
      return;
    }
    let active = true;
    void spacesApi
      .conversations(activeSpaceId)
      .then((result) => {
        if (active) setConversations(result.conversations);
      })
      .catch(() => {
        if (active) setConversations([]);
      });
    return () => {
      active = false;
    };
  }, [activeSpace, activeSpaceId, enabled, readable, snapshotReady]);

  useEffect(() => {
    if (!snapshotReady || !activeSpaceId || !activeSpace) return;
    const reload = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (detail?.space_id !== activeSpaceId) return;
      void spacesApi
        .conversations(activeSpaceId)
        .then(({ conversations: next }) => setConversations(next))
        .catch(() => undefined);
    };
    window.addEventListener("misty:space-conversation-event", reload);
    return () => window.removeEventListener("misty:space-conversation-event", reload);
  }, [activeSpace, activeSpaceId, snapshotReady]);

  const upsertConversation = (saved: SpaceConversation) => {
    setConversations((current) => {
      const exists = current.some((conversation) => conversation.id === saved.id);
      return exists
        ? current.map((conversation) => (conversation.id === saved.id ? saved : conversation))
        : [saved, ...current];
    });
  };

  const removeConversation = (conversationId: string) => {
    setConversations((current) =>
      current.filter((conversation) => conversation.id !== conversationId),
    );
  };

  return { conversations, upsertConversation, removeConversation };
}
