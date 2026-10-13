import { House, MessagesSquare, UsersRound } from "lucide-react";
import { useCallback, useState } from "react";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuChevron,
  Popover,
  PopoverAnchor,
  Pressable,
  Skeleton,
  toolbarIconProps,
} from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "../../GlobalCreateSpaceDialog";
import { spaceNavigationName } from "../../defaultSpace";
import { SpaceMembersPopover } from "../../members";
import { SpaceAvatar } from "../SpaceAvatar";
import { isSpacePanel, SpaceDialogs, type SpaceDialog } from "./SpaceDialogs";
import { SpaceMenuItems } from "./SpaceMenuItems";
import { useWindowSpace } from "./useWindowSpace";

/** Opens one of the Space's pages in the focused pane. */
function openSpaceRoute(route: string) {
  const surface = workspaceSurfaceFromRoute(route);
  if (!surface) return;
  const workspace = useWorkspaceStore.getState();
  const view = workspace.openDestination(surface);
  if (view.route !== route) workspace.updateViewRoute(view.id, route, true);
}

/**
 * The Space row: the Space this window shows, with its menu, and its Home, Chat and People.
 * It sits under the sidebar's window controls; with the sidebar collapsed it ends the
 * tab strip as `compact`, a tab hanging from the window's top edge (so it doesn't read as
 * another browser tab), and Home, Chat and People move into its menu.
 */
export function SpaceRow({ compact = false }: { compact?: boolean }) {
  const space = useWindowSpace();
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const [error, setError] = useState("");
  const close = useCallback(() => setDialog(null), []);
  if (!space)
    return compact ? null : (
      <div className="flex h-9 items-center gap-2 px-2" aria-hidden>
        <Skeleton className="size-5 rounded-md" />
        <Skeleton className="h-3.5 w-24" />
      </div>
    );
  const base = `/spaces/${encodeURIComponent(space.id)}`;
  const page = (to: "home" | "chat") =>
    openSpaceRoute(to === "home" ? `${base}/home` : `${base}/social/misty`);
  const name = spaceNavigationName(space);
  return (
    <Popover open={isSpacePanel(dialog)} onOpenChange={(next) => !next && close()}>
      <PopoverAnchor asChild>
        <div
          role="toolbar"
          aria-label={`${space.name || "Space"} controls`}
          data-misty-window-drag-block="true"
          className={cn(
            "flex min-w-0 shrink-0 items-center gap-0.5",
            compact ? "misty-workspace-space self-stretch pl-2" : "h-9",
          )}
        >
          <GlobalCreateSpaceDialog>
            {(create) => (
              <DropdownMenu onOpenChange={() => setError("")}>
                <DropdownMenuTrigger asChild>
                  <Pressable
                    aria-label={`${name}, Space menu`}
                    className={cn(
                      "flex min-w-0 items-center gap-2 text-sm text-cream-bright",
                      compact
                        ? "h-8 max-w-56 self-center rounded-lg px-2 hover:bg-control-hover data-[state=open]:bg-control-hover"
                        : "h-8 max-w-full rounded-md px-1.5 hover:bg-charcoal-hover data-[state=open]:bg-charcoal-hover",
                    )}
                  >
                    <SpaceAvatar
                      space={space}
                      className="size-5 shrink-0 rounded-md"
                      fallbackClassName="text-[9px] font-semibold"
                    />
                    <span className="min-w-0 truncate font-medium">{name}</span>
                    {!compact && <MenuChevron className="size-5 text-cream-muted" />}
                  </Pressable>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side={compact ? undefined : "bottom"}
                  align={compact ? "end" : "start"}
                  className="w-56 max-w-[calc(100vw-16px)]"
                >
                  <SpaceMenuItems
                    space={space}
                    compact={compact}
                    onPage={page}
                    onDialog={setDialog}
                    onCreate={create}
                    onError={setError}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </GlobalCreateSpaceDialog>
          {error && (
            <p
              role="alert"
              className="m-0 min-w-0 truncate px-1 text-xs text-cream-muted"
              title={error}
            >
              {error}
            </p>
          )}
          {!compact && (
            <>
              <span className="flex-1" />
              {/* Sidebar chrome, like the back and forward buttons above: the same button size,
                  glyph size and spacing, from browserToolbar.css. These glyphs fill their box,
                  so they take the full-glyph size (`size-4`), like reload. */}
              <div className="flex items-center gap-1.5" data-browser-toolbar data-sidebar>
                <IconButton label={`${space.name || "Space"} home`} onClick={() => page("home")}>
                  <House {...toolbarIconProps} className="size-4" />
                </IconButton>
                <IconButton label="Chat" onClick={() => page("chat")}>
                  <MessagesSquare {...toolbarIconProps} className="size-4" />
                </IconButton>
                <SpaceMembersPopover
                  space={space}
                  side="bottom"
                  onManage={(invite) => setDialog(invite ? "invite" : "members")}
                  trigger={
                    <IconButton label="People">
                      <UsersRound {...toolbarIconProps} className="size-4" />
                    </IconButton>
                  }
                />
              </div>
            </>
          )}
          <SpaceDialogs space={space} open={dialog} onClose={close} />
        </div>
      </PopoverAnchor>
    </Popover>
  );
}
