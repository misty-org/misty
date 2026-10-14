import { Check, PanelsTopLeft, Plus } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { dockLeaves, useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MenuTrigger,
  toolbarIconProps,
} from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "../GlobalCreateSpaceDialog";
import { preferredDefaultSpace, spaceNavigationName } from "../defaultSpace";
import { spaceLandingRoute } from "../navigation";
import { useLastSpaceStore } from "../store/useLastSpaceStore";
import { useSpacesStore } from "../store/useSpacesStore";
import { SpaceAvatar } from "./SpaceAvatar";

/** The Space the focused view shows, or "" when it shows something else. */
function useActiveSpaceId(): string {
  return useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((p) => p.id === state.layout.focusedPaneId) ?? panes[0];
    const view = pane?.views.find((item) => item.id === pane.activeViewId);
    if (view?.surfaceId !== "space") return "";
    const segment = view.route.split(/[?#]/)[0].split("/")[2] ?? "";
    try {
      return decodeURIComponent(segment);
    } catch {
      return "";
    }
  });
}

/** One button for all Spaces: it lists them, marks the open one, and creates another. */
export function SpacesMenuButton({
  toolbar = false,
  labeled = false,
}: {
  toolbar?: boolean;
  /** Shows the word beside the icon, so the button names itself. */
  labeled?: boolean;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const activeSpaceId = useActiveSpaceId();
  const lastSpaceId = useLastSpaceStore((state) => state.id);
  // Open on a Space, that is the one; elsewhere, the Space opened last, else the default.
  useEffect(() => {
    if (activeSpaceId) useLastSpaceStore.getState().remember(activeSpaceId);
  }, [activeSpaceId]);
  const shown =
    spaces.find((space) => space.id === activeSpaceId) ??
    spaces.find((space) => space.id === lastSpaceId) ??
    preferredDefaultSpace(spaces);
  return (
    <GlobalCreateSpaceDialog>
      {(create) => (
        <DropdownMenu>
          <MenuTrigger
            iconOnly={!labeled}
            size={toolbar ? undefined : "xs"}
            label="Spaces"
            title={shown ? `Spaces: ${shown.name}` : "Spaces"}
            value={labeled && shown ? shown.name : undefined}
            icon={
              labeled && shown ? (
                <SpaceAvatar
                  space={shown}
                  className="size-5 rounded-md"
                  fallbackClassName="text-[9px] font-semibold"
                />
              ) : toolbar ? (
                <PanelsTopLeft {...toolbarIconProps} />
              ) : (
                <PanelsTopLeft className="size-4" aria-hidden="true" />
              )
            }
          />
          <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-16px)]">
            {spaces.map((space) => (
              <DropdownMenuItem
                key={space.id}
                onSelect={() => {
                  const surface = workspaceSurfaceFromRoute(spaceLandingRoute(space.id, user?.id));
                  if (!surface) return;
                  navigate(useWorkspaceStore.getState().openDestination(surface).route, {
                    replace: true,
                  });
                }}
              >
                <SpaceAvatar
                  space={space}
                  className="size-5 rounded-md"
                  fallbackClassName="text-[9px] font-semibold"
                />
                <span className="min-w-0 flex-1 truncate">{spaceNavigationName(space)}</span>
                {space.id === shown?.id ? <Check className="size-4" aria-hidden="true" /> : null}
              </DropdownMenuItem>
            ))}
            {spaces.length ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              aria-label="Create Space"
              onSelect={() => window.setTimeout(create, 0)}
            >
              <Plus className="size-4" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Create Space</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </GlobalCreateSpaceDialog>
  );
}
