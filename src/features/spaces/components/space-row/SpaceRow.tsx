import { Brain, House, Library, MessagesSquare, UsersRound } from "lucide-react";
import { useCallback, useState } from "react";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/app-windows";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorNotification,
  IconButton,
  MenuItem,
  MenuTrigger,
  Popover,
  PopoverAnchor,
  Skeleton,
  toolbarIconProps,
} from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "../../create/GlobalCreateSpaceDialog";
import { spaceNavigationName } from "../../routes/defaultSpace";
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

/** The Space button with no Space behind it, for a signed-out window to show it is there.
 * Pressing it asks to sign in. */
export function SpaceRowPreview({ onSignIn }: { onSignIn: () => void }) {
  return (
    <IconButton label="Space" onClick={onSignIn}>
      <House {...toolbarIconProps} className="size-4" />
    </IconButton>
  );
}

/**
 * The Space button, among the pinned tools at the sidebar's foot. Its menu opens upward with the
 * Space's pages (Home, Chat, Library, Memory and People), then the Spaces to switch to and the
 * Space's own actions, so Spaces take no room in the sidebar until they are asked for.
 */
export function SpaceRow({ labeled = false }: { labeled?: boolean }) {
  const space = useWindowSpace();
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const [error, setError] = useState("");
  const close = useCallback(() => setDialog(null), []);
  if (!space)
    return labeled ? (
      <div className="flex h-9 items-center gap-2 px-2" aria-hidden>
        <Skeleton className="size-5 rounded-md" />
        <Skeleton className="h-3 w-28" />
      </div>
    ) : (
      <Skeleton className="mx-1 size-5 rounded-md" aria-hidden />
    );
  const base = `/spaces/${encodeURIComponent(space.id)}`;
  const name = spaceNavigationName(space);
  const later = (run: () => void) => () => window.setTimeout(run, 0);
  return (
    <Popover open={isSpacePanel(dialog)} onOpenChange={(next) => !next && close()}>
      <PopoverAnchor asChild>
        <div className={labeled ? "flex min-w-0 flex-1 items-center" : "flex items-center"}>
          <GlobalCreateSpaceDialog>
            {(create) => (
              <DropdownMenu onOpenChange={() => setError("")}>
                {labeled ? (
                  // The sidebar's first row: which Space this is, by its avatar and name.
                  <MenuTrigger
                    label={`${name}, Space menu`}
                    value={name}
                    className="h-9 w-full justify-start px-2 text-sm font-medium text-cream"
                    icon={
                      <SpaceAvatar
                        space={space}
                        className="size-5 rounded-[5px]"
                        fallbackClassName="text-3xs font-semibold"
                      />
                    }
                  />
                ) : (
                  <DropdownMenuTrigger asChild>
                    <IconButton label={`${name}, Space menu`}>
                      <SpaceAvatar
                        space={space}
                        className="size-4.5 rounded-[5px]"
                        fallbackClassName="text-3xs font-semibold"
                      />
                    </IconButton>
                  </DropdownMenuTrigger>
                )}
                <DropdownMenuContent
                  side={labeled ? "bottom" : "top"}
                  align="start"
                  className="w-56 max-w-[calc(100vw-16px)]"
                >
                  <MenuItem
                    icon={<House className="size-4" />}
                    label="Home"
                    onSelect={() => openSpaceRoute(`${base}/home`)}
                  />
                  <MenuItem
                    icon={<MessagesSquare className="size-4" />}
                    label="Chat"
                    onSelect={() => openSpaceRoute(`${base}/chat`)}
                  />
                  <MenuItem
                    icon={<Library className="size-4" />}
                    label="Library"
                    onSelect={() => openSpaceRoute(`${base}/library`)}
                  />
                  <MenuItem
                    icon={<Brain className="size-4" />}
                    label="Memory"
                    onSelect={() => openSpaceRoute(`${base}/memory`)}
                  />
                  <MenuItem
                    icon={<UsersRound className="size-4" />}
                    label="People"
                    onSelect={later(() => setDialog("members"))}
                  />
                  <DropdownMenuSeparator />
                  <SpaceMenuItems space={space} onDialog={setDialog} onCreate={create} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </GlobalCreateSpaceDialog>
          <ErrorNotification message={error} onDismiss={() => setError("")} />
          <SpaceDialogs space={space} open={dialog} onClose={close} />
        </div>
      </PopoverAnchor>
    </Popover>
  );
}
