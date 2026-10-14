import { Check, PanelsTopLeft, Plus } from "lucide-react";
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
import { spaceNavigationName } from "../defaultSpace";
import { spaceLandingRoute } from "../navigation";
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
export function SpacesMenuButton({ toolbar = false }: { toolbar?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const activeSpaceId = useActiveSpaceId();
  return (
    <GlobalCreateSpaceDialog>
      {(create) => (
        <DropdownMenu>
          <MenuTrigger
            iconOnly
            size={toolbar ? undefined : "xs"}
            label="Spaces"
            title="Spaces"
            icon={
              toolbar ? (
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
                {space.id === activeSpaceId ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : null}
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
