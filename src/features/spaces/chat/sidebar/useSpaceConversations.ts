import { spacesApi } from "@/api/spaces/api";
import type { SpaceConversation } from "@/api/spaces/dto/interfaces/types";
import { useCallback, useEffect, useState } from "react";

/**
 * The Space's conversations for the chat sidebar, kept in step with realtime events.
 * Fetched rather than read from the Spaces store, which only snapshots membership.
 */
export function useSpaceConversations(spaceId: string, readable: boolean) {
  const [conversations, setConversations] = useState<SpaceConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(
    () =>
      spacesApi
        .conversations(spaceId)
        .then((result) => result.conversations)
        .catch(() => null),
    [spaceId],
  );
  useEffect(() => {
    if (!readable) {
      setConversations([]);
      return;
    }
    let active = true;
    setLoading(true);
    void reload().then((next) => {
      if (!active) return;
      setConversations(next ?? []);
      setLoading(false);
    });
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (detail?.space_id !== spaceId) return;
      void reload().then((next) => {
        if (active && next) setConversations(next);
      });
    };
    window.addEventListener("misty:space-conversation-event", onEvent);
    return () => {
      active = false;
      window.removeEventListener("misty:space-conversation-event", onEvent);
    };
  }, [readable, reload, spaceId]);
  const upsert = (saved: SpaceConversation) =>
    setConversations((current) =>
      current.some((item) => item.id === saved.id)
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...current],
    );
  const remove = (conversationId: string) =>
    setConversations((current) => current.filter((item) => item.id !== conversationId));
  return { conversations, loading, upsert, remove };
}
