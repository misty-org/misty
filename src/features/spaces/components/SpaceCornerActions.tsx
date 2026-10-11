import { House, MessagesSquare, Settings2, UsersRound } from "lucide-react";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import type { Space } from "@/api/spaces/dto/entities";
import { IconButton } from "@/shared/ui";
import { SpaceMembersPopover } from "../members";

/**
 * The same three controls in the top-right of every Space page, now that there is no
 * Space bar: the way home, the chat, who's in it, and the Space's preferences. The home page leaves
 * out its own Home button.
 */
export function SpaceCornerActions({ space, home = true }: { space: Space; home?: boolean }) {
  // Works from a page and from the top-edge island alike: open the Space's view, then route it.
  const navigate = (route: string) => {
    const surface = workspaceSurfaceFromRoute(route);
    if (!surface) return;
    const workspace = useWorkspaceStore.getState();
    const view = workspace.openDestination(surface);
    if (view.route !== route) workspace.updateViewRoute(view.id, route, true);
  };
  const base = `/spaces/${encodeURIComponent(space.id)}`;
  return (
    <nav
      className="flex shrink-0 items-center gap-1"
      aria-label={`${space.name || "Space"} actions`}
    >
      {home && (
        <IconButton
          size="md"
          label={`${space.name || "Space"} home`}
          onClick={() => navigate(`${base}/home`)}
        >
          <House aria-hidden />
        </IconButton>
      )}
      <IconButton size="md" label="Chat" onClick={() => navigate(`${base}/social/misty`)}>
        <MessagesSquare aria-hidden />
      </IconButton>
      <SpaceMembersPopover
        space={space}
        side="bottom"
        trigger={
          <IconButton size="md" label="Members">
            <UsersRound aria-hidden />
          </IconButton>
        }
      />
      <IconButton size="md" label="Space preferences" onClick={() => navigate(`${base}/settings`)}>
        <Settings2 aria-hidden />
      </IconButton>
    </nav>
  );
}
