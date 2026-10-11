import { Check, PanelsTopLeft, Plus } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { dockLeaves, useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import {
  AvatarShuffleStack,
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

/** The Space the focused view shows; elsewhere, the Space opened last, else the default. */
export function useShownSpace() {
  const spaces = useSpacesStore((state) => state.spaces);
  const activeSpaceId = useActiveSpaceId();
  const lastSpaceId = useLastSpaceStore((state) => state.id);
  useEffect(() => {
    if (activeSpaceId) useLastSpaceStore.getState().remember(activeSpaceId);
  }, [activeSpaceId]);
  return (
    spaces.find((space) => space.id === activeSpaceId) ??
    spaces.find((space) => space.id === lastSpaceId) ??
    preferredDefaultSpace(spaces)
  );
}

/** The Spaces pill: the current Space as one button that opens the menu to switch or create. */
export function SpacesMenuButton({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const shown = useShownSpace();
  const openSpace = (space: (typeof spaces)[number]) => {
    const surface = workspaceSurfaceFromRoute(spaceLandingRoute(space.id, user?.id));
    if (!surface) return;
    navigate(useWorkspaceStore.getState().openDestination(surface).route, { replace: true });
  };
  return (
    <GlobalCreateSpaceDialog>
      {(create) => (
        <DropdownMenu onOpenChange={onOpenChange}>
          {/* One pill: the current Space, opening the menu to switch or create. */}
          <MenuTrigger
            label="Choose Space"
            value={shown ? spaceNavigationName(shown) : "Spaces"}
            className="h-9 min-w-0 max-w-80 gap-2.5 px-2.5 text-base font-medium [&_[data-avatar-stack]]:scale-110"
            icon={
              shown ? (
                <AvatarShuffleStack
                  activeId={shown.id}
                  items={spaces.map((space) => ({
                    id: space.id,
                    node: (
                      <SpaceAvatar
                        space={space}
                        className="size-5 rounded-full"
                        fallbackClassName="text-[9px] font-semibold"
                      />
                    ),
                  }))}
                />
              ) : (
                <PanelsTopLeft {...toolbarIconProps} />
              )
            }
          />
          <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-16px)]">
            {spaces.map((space) => (
              <DropdownMenuItem key={space.id} onSelect={() => openSpace(space)}>
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
