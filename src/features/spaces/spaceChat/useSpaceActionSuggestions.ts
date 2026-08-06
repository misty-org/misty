import { useCallback, useEffect, useState } from "react";
import type { SpaceActionSuggestionBatch } from "@/models/interfaces/features/spaces/types";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";

export function useSpaceActionSuggestions(spaceId: string, conversationId: string) {
  const [items, setItems] = useState<SpaceActionSuggestionBatch[]>([]);
  const refresh = useCallback(async () => {
    if (!spaceId) return;
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
  }, [conversationId, spaceId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { items, refresh };
}
