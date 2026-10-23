import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import type { Space } from "@/api/spaces/dto/entities";
import { useSpacesStore } from "../store/useSpacesStore";
import { spaceChatConversationPath, spaceChatPath } from "./chatRoute";

/** Your own Space, whose chat the Chat buttons and the chat panel show. */
export function homeChatSpace(spaces: Space[]): Space | undefined {
  return (
    spaces.find((space) => space.is_default && space.role === "owner") ??
    spaces.find((space) => space.is_default) ??
    spaces[0]
  );
}

/**
 * Opens the chat of your own Space, at a conversation when given, in a new tab. The tab that
 * asked keeps its side panels; they are not part of the new tab.
 */
export function useOpenSpaceChat() {
  const navigate = useNavigate();
  return useCallback(
    (conversationId = "") => {
      const home = homeChatSpace(useSpacesStore.getState().spaces);
      if (!home) return;
      const request = workspaceSurfaceFromRoute(
        conversationId
          ? spaceChatConversationPath(home.id, conversationId)
          : spaceChatPath(home.id),
      );
      if (!request) return;
      const tab = useWorkspaceStore.getState().addSurface(request);
      navigate(tab.route, { replace: true });
    },
    [navigate],
  );
}
