import { Brain, House, Library, MessagesSquare, Plus, UsersRound } from "lucide-react";
import { useCallback, useState } from "react";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/app-windows";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  ErrorNotification,
  IconButton,
  MenuChevron,
  Popover,
  PopoverAnchor,
  Pressable,
  Skeleton,
  toolbarIconProps,
} from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "../../create/GlobalCreateSpaceDialog";
import { spaceNavigationName } from "../../routes/defaultSpace";
import { SpaceMembersPopover } from "../../members";
import { SpaceAvatar } from "../SpaceAvatar";
import { isSpacePanel, SpaceDialogs, type SpaceDialog } from "./SpaceDialogs";
import { MemoryButton } from "./MemoryButton";
import { SpaceMenuItems } from "./SpaceMenuItems";
import { SpaceCreateMenu } from "./SpaceCreateMenu";
import { useWindowSpace } from "./useWindowSpace";

type RowAlignment = "left" | "center" | "right";

const rowClass = (alignment: RowAlignment) =>
  cn(
    "flex h-full w-full min-w-0 items-center px-2",
    alignment === "left" && "justify-start",
    alignment === "center" && "justify-center",
    alignment === "right" && "justify-end",
  );

const rowDivider = (
  <span className="mx-2.5 h-5 w-px shrink-0 self-center bg-white/[0.17]" aria-hidden="true" />
);

/** The chevron is thin, so it takes the 20px of the sidebar's thin glyphs (browserToolbar.css),
 * at their stroke. */
const rowChevronClass = "size-5 stroke-[1.75] text-cream-muted";

/** Opens one of the Space's pages in the focused pane. */
function openSpaceRoute(route: string) {
  const surface = workspaceSurfaceFromRoute(route);
  if (!surface) return;
  const workspace = useWorkspaceStore.getState();
  const view = workspace.openDestination(surface);
  if (view.route !== route) workspace.updateViewRoute(view.id, route, true);
}

/** The row's controls with no Space behind them, for a signed-out window to show what is there.
 * It has no Space to name and no people in it, so those two are left out; pressing any of the
 * others asks to sign in. */
export function SpaceRowPreview({
  alignment = "left",
  onSignIn,
}: {
  alignment?: RowAlignment;
  onSignIn: () => void;
}) {
  return (
    <div role="toolbar" aria-label="Space controls" className={rowClass(alignment)}>
      <div className="flex items-center gap-1.5" data-browser-toolbar data-sidebar>
        <IconButton label="Home" onClick={onSignIn}>
          <House {...toolbarIconProps} className="size-4" />
        </IconButton>
        <IconButton label="Chat" onClick={onSignIn}>
          <MessagesSquare {...toolbarIconProps} className="size-4" />
        </IconButton>
        <IconButton label="Library" onClick={onSignIn}>
          <Library {...toolbarIconProps} className="size-4" />
        </IconButton>
        <IconButton label="Memory" onClick={onSignIn}>
          <Brain {...toolbarIconProps} className="size-4" />
        </IconButton>
      </div>
      {rowDivider}
      <Button
        aria-label="New"
        variant="primary"
        size="sm"
        className="h-7 gap-1 pr-2 pl-1.5 text-xs"
        onClick={onSignIn}
      >
        <Plus {...toolbarIconProps} className="size-4.5" />
        <span>New</span>
      </Button>
    </div>
  );
}

/**
 * The Space row: the Space this window shows, with its menu, and its Home, Chat and People.
 * It fills the Space bar above the pages.
 */
export function SpaceRow({
  alignment = "left",
}: {
  /** Where the Space bar's sections sit along it. */
  alignment?: RowAlignment;
}) {
  const space = useWindowSpace();
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const [error, setError] = useState("");
  const close = useCallback(() => setDialog(null), []);
  if (!space)
    return (
      <div className="flex h-full items-center gap-2 px-3.5" aria-hidden>
        <Skeleton className="size-4.5 rounded-md" />
        <Skeleton className="h-3.5 w-24" />
      </div>
    );
  const base = `/spaces/${encodeURIComponent(space.id)}`;
  const name = spaceNavigationName(space);
  const pageButton = (route: string, label: string, Icon: typeof House) => (
    <IconButton label={label} onClick={() => openSpaceRoute(`${base}/${route}`)}>
      <Icon {...toolbarIconProps} className="size-4" />
    </IconButton>
  );
  const actions = (
    <>
      {rowDivider}
      <div
        className="flex items-center justify-self-center gap-1.5"
        data-browser-toolbar
        data-sidebar
      >
        <IconButton
          label={`${space.name || "Space"} home`}
          onClick={() => openSpaceRoute(`${base}/home`)}
        >
          <House {...toolbarIconProps} className="size-4" />
        </IconButton>
        {pageButton("chat", "Chat", MessagesSquare)}
        {pageButton("library", "Library", Library)}
        <MemoryButton onOpen={() => openSpaceRoute(`${base}/memory`)} />
      </div>
      {rowDivider}
      <SpaceCreateMenu spaceId={space.id} onError={setError} />
    </>
  );
  return (
    <Popover open={isSpacePanel(dialog)} onOpenChange={(next) => !next && close()}>
      <PopoverAnchor asChild>
        <div
          role="toolbar"
          aria-label={`${space.name || "Space"} controls`}
          className={rowClass(alignment)}
        >
          <GlobalCreateSpaceDialog>
            {(create) => (
              <DropdownMenu onOpenChange={() => setError("")}>
                <DropdownMenuTrigger asChild>
                  <Pressable
                    aria-label={`${name}, Space menu`}
                    className={
                      "flex h-7 max-w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-sm " +
                      "text-cream-bright hover:bg-charcoal-hover data-[state=open]:bg-charcoal-hover"
                    }
                  >
                    <SpaceAvatar
                      space={space}
                      className="size-4.5 shrink-0 rounded-md"
                      fallbackClassName="text-3xs font-semibold"
                    />
                    <span className="min-w-0 truncate font-medium">{name}</span>
                    <MenuChevron className={rowChevronClass} />
                  </Pressable>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="bottom"
                  align="start"
                  className="w-56 max-w-[calc(100vw-16px)]"
                >
                  <SpaceMenuItems space={space} onDialog={setDialog} onCreate={create} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </GlobalCreateSpaceDialog>
          <div className="ml-1.5 flex items-center" data-browser-toolbar data-sidebar>
            <SpaceMembersPopover
              space={space}
              side="bottom"
              align="start"
              onManage={(invite) => setDialog(invite ? "invite" : "members")}
              trigger={
                <IconButton label="People">
                  <UsersRound {...toolbarIconProps} className="size-4" />
                </IconButton>
              }
            />
          </div>
          <ErrorNotification message={error} onDismiss={() => setError("")} />
          {actions}
          <SpaceDialogs space={space} open={dialog} onClose={close} />
        </div>
      </PopoverAnchor>
    </Popover>
  );
}
