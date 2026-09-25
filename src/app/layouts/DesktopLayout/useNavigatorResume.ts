import { useNavigate } from "react-router-dom";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";

/** Navbar destinations replace the focused pane. */
export function useNavigatorResume(options: {
  accountId: string;
  key: string;
  fallbackRoute: string;
  activeRoute?: string;
  matchesRoute?: (route: string) => boolean;
}) {
  const navigate = useNavigate();
  return () => {
    const surface = workspaceSurfaceFromRoute(options.fallbackRoute);
    if (!surface) return;
    const tab = useWorkspaceStore.getState().openSurface({ ...surface, syncExistingRoute: true });
    navigate(tab.route);
  };
}
