import { useEffect, useState } from "react";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceConversation } from "@/models/interfaces/features/spaces/types";
import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";

export function useSpaceConversationChat(
  spaceId: string,
  conversationId: string,
  canRead: boolean,
) {
  const [conversations, setConversations] = useState<SpaceConversation[]>([]);
  const [messages, setMessages] = useState<SpaceMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!conversationId || !canRead) {
      setConversations([]);
      setMessages([]);
      setError("");
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([
      spacesApi.conversations(spaceId),
      spacesApi.conversationMessages(spaceId, conversationId),
    ])
      .then(([conversationResult, messageResult]) => {
        if (!active) return;
        setConversations(conversationResult.conversations);
        setMessages([...messageResult.messages].reverse());
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "This group chat could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const reload = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string; conversationId?: string }>).detail;
      if (detail?.spaceId !== spaceId || detail.conversationId !== conversationId) return;
      void spacesApi.conversationMessages(spaceId, conversationId).then(({ messages: next }) => {
        if (active) setMessages([...next].reverse());
      });
    };
    window.addEventListener("misty:space-message-event", reload);
    return () => {
      active = false;
      window.removeEventListener("misty:space-message-event", reload);
    };
  }, [canRead, conversationId, spaceId]);
  return { conversations, messages, setMessages, loading, error, setError };
}
