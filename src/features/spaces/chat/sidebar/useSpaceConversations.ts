import { spacesApi } from "@/api/spaces/api";
import type { SpaceConversation } from "@/api/spaces/dto/interfaces/types";
import { readApiSessionGeneration } from "@/api/client/session";
import { useCallback, useEffect, useState } from "react";

/**
 * The Space's conversations for the chat sidebar, kept in step with realtime events.
 * Fetched rather than read from the Spaces store, which only snapshots membership.
 */
export function useSpaceConversations(spaceId: string, readable: boolean) {
  const scope = `${readApiSessionGeneration()}:${spaceId}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; items: SpaceConversation[] }>({
    scope,
    items: [],
  });
  const conversations = readable && snapshot.scope === scope ? snapshot.items : [];
  const setConversations = useCallback(
    (update: SpaceConversation[] | ((items: SpaceConversation[]) => SpaceConversation[])) =>
      setSnapshot((current) => ({
        scope,
        items:
          typeof update === "function"
            ? update(current.scope === scope ? current.items : [])
            : update,
      })),
    [scope],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
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
    setError("");
    void reload().then((next) => {
      if (!active) return;
      if (next) setConversations(next);
      else setError("Chats could not be loaded.");
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
  }, [readable, reload, spaceId, revision, setConversations]);
  const upsert = (saved: SpaceConversation) =>
    setConversations((current) =>
      current.some((item) => item.id === saved.id)
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...current],
    );
  const remove = (conversationId: string) =>
    setConversations((current) => current.filter((item) => item.id !== conversationId));
  return {
    conversations,
    loading: readable && (loading || snapshot.scope !== scope),
    error,
    retry: () => setRevision((value) => value + 1),
    upsert,
    remove,
  };
}
