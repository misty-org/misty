import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/app-windows";
import type { Space } from "../api/dto/entities";
import { useSpacesStore } from "../list/use_spaces_store";
import { spaceChatConversationPath, spaceChatPath } from "./chat_route";

export function homeChatSpace(spaces: Space[]): Space | undefined {
  return (
    spaces.find((space) => space.is_default && space.role === "owner") ??
    spaces.find((space) => space.is_default) ??
    spaces[0]
  );
}

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
