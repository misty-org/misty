import { Link, useNavigate } from "react-router-dom";
import {
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type WorkspaceTab,
} from "@/features/workspace";
import { cn, navigationMenuLinkClass } from "@/shared/ui";
import { appIconStrokeWidth } from "@/shared/ui/app-icons";
import { PanelsTopLeft } from "lucide-react";

/** The global navigator opens Spaces; each Space pane owns its tools. */
export function WorkspaceSpaceNavigation({
  activeTab,
  onOpen,
}: {
  activeTab: WorkspaceTab | undefined;
  onOpen?: () => void;
}) {
  const navigate = useNavigate();
  const active = activeTab?.surfaceId === "space";
  return (
    <Link
      to="/spaces"
      className={cn(navigationMenuLinkClass, "w-full", active && "text-cream-bright")}
      aria-label="Spaces"
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        const surface = workspaceSurfaceFromRoute("/spaces");
        if (!surface) return;
        const opened = useWorkspaceStore.getState().openSurface(surface);
        navigate(opened.route);
        onOpen?.();
      }}
    >
      <PanelsTopLeft
        className="size-4 shrink-0 justify-self-center"
        size={16}
        strokeWidth={appIconStrokeWidth}
        aria-hidden="true"
      />
      <span>Spaces</span>
    </Link>
  );
}
