import { ChevronDown, House, MessagesSquare, UsersRound } from "lucide-react";
import { useCallback, useState } from "react";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  Pressable,
  Skeleton,
} from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "../../GlobalCreateSpaceDialog";
import { spaceNavigationName } from "../../defaultSpace";
import { SpaceMembersPopover } from "../../members";
import { SpaceAvatar } from "../SpaceAvatar";
import { SpaceDialogs, type SpaceDialog } from "./SpaceDialogs";
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
 * It sits under the sidebar's window controls; with the sidebar collapsed it starts the
 * tab strip as `compact`, and Home, Chat and People move into its menu.
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
    <div
      role="toolbar"
      aria-label={`${space.name || "Space"} controls`}
      data-misty-window-drag-block="true"
      className={cn("flex min-w-0 shrink-0 items-center gap-0.5", compact ? "pr-1" : "h-9 px-1")}
    >
      <GlobalCreateSpaceDialog>
        {(create) => (
          <DropdownMenu onOpenChange={() => setError("")}>
            <DropdownMenuTrigger asChild>
              <Pressable
                aria-label={`${name}, Space menu`}
                className={cn(
                  "flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-sm text-cream-bright",
                  "hover:bg-charcoal-hover data-[state=open]:bg-charcoal-hover",
                  compact ? "max-w-48" : "max-w-full",
                )}
              >
                <SpaceAvatar
                  space={space}
                  className="size-5 shrink-0 rounded-md"
                  fallbackClassName="text-[9px] font-semibold"
                />
                <span className="min-w-0 truncate font-medium">{name}</span>
                <ChevronDown aria-hidden className="size-3.5 shrink-0 text-cream-muted" />
              </Pressable>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-16px)]">
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
        <p role="alert" className="sr-only">
          {error}
        </p>
      )}
      {!compact && (
        <>
          <span className="flex-1" />
          <IconButton
            size="xs"
            label={`${space.name || "Space"} home`}
            onClick={() => page("home")}
          >
            <House aria-hidden className="size-4" />
          </IconButton>
          <IconButton size="xs" label="Chat" onClick={() => page("chat")}>
            <MessagesSquare aria-hidden className="size-4" />
          </IconButton>
          <SpaceMembersPopover
            space={space}
            side="bottom"
            onManage={(invite) => setDialog(invite ? "invite" : "members")}
            trigger={
              <IconButton size="xs" label="People">
                <UsersRound aria-hidden className="size-4" />
              </IconButton>
            }
          />
        </>
      )}
      <SpaceDialogs space={space} open={dialog} onClose={close} />
    </div>
  );
}
