import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { useSpacesStore } from "../store/useSpacesStore";
import { spaceChatPath } from "./chatRoute";

/** Opens the chat of your own Space as a tab; the toolbar and sidebar chat icons use it. */
export function useOpenSpaceChat() {
  const navigate = useNavigate();
  return useCallback(() => {
    const spaces = useSpacesStore.getState().spaces;
    const home =
      spaces.find((space) => space.is_default && space.role === "owner") ??
      spaces.find((space) => space.is_default) ??
      spaces[0];
    if (!home) return;
    const request = workspaceSurfaceFromRoute(spaceChatPath(home.id));
    if (!request) return;
    const tab = useWorkspaceStore.getState().openDestination(request);
    navigate(tab.route, { replace: true });
  }, [navigate]);
}
