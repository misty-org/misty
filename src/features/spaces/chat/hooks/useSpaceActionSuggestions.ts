import { socialEvents } from "../socialRuntime";
import { socialApi as spacesApi } from "@/features/spaces/chat/socialRuntime";
import type { SpaceActionSuggestionBatch } from "@/api/spaces/dto/interfaces/types";
import { useCallback, useEffect, useState } from "react";

export function useSpaceActionSuggestions(spaceId: string, conversationId: string, enabled = true) {
  const [items, setItems] = useState<SpaceActionSuggestionBatch[]>([]);
  const refresh = useCallback(async () => {
    if (!spaceId || !enabled) return;
    try {
      const result = await spacesApi.actionSuggestions(spaceId);
      setItems(
        result.suggestions.filter(
          (item) =>
            !item.dismissed_by_me &&
            (conversationId
              ? item.scope.kind === "conversation" && item.scope.conversation_id === conversationId
              : item.scope.kind === "everyone"),
        ),
      );
    } catch {
      // Suggestions are an optional enhancement; chat remains fully usable.
    }
  }, [conversationId, enabled, spaceId]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }
    void refresh();
    const onSuggestionEvent = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          space_id?: string;
          payload?: { conversation_id?: string };
        }>
      ).detail;
      if (detail?.space_id !== spaceId) return;
      const eventConversationId = String(detail.payload?.conversation_id ?? "");
      if (eventConversationId !== conversationId) return;
      void refresh();
    };
    socialEvents.addEventListener("misty:space-action-suggestion-event", onSuggestionEvent);
    return () =>
      socialEvents.removeEventListener("misty:space-action-suggestion-event", onSuggestionEvent);
  }, [conversationId, enabled, refresh, spaceId]);

  return { items, refresh };
}
