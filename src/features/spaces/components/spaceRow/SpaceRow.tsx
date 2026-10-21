import {
  Bot,
  Folder,
  House,
  MessagesSquare,
  NotebookPen,
  PencilRuler,
  UsersRound,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useMistyPanelStore } from "@/features/agents";
import { showAgentsPanel } from "@/features/browser/workspace/BrowserMistyPanel";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import {
  appIcon,
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

const AgentsIcon = appIcon("agents") ?? Bot;

/** Agents in a side panel beside the page; pressed while that panel is open. */
function AgentsPanelButton() {
  const shown = useMistyPanelStore((s) => s.open);
  return (
    <IconButton label="Agents" aria-pressed={shown} onClick={showAgentsPanel}>
      <AgentsIcon {...toolbarIconProps} className="size-4" />
    </IconButton>
  );
}

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
 * It fills the Space bar above the pages.
 */
export function SpaceRow({
  alignment = "left",
}: {
  /** Where the Space bar's sections sit along it. */
  alignment?: "left" | "center" | "right";
}) {
  const space = useWindowSpace();
  const chatShown = useMistyPanelStore((s) => s.chatOpen);
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const [error, setError] = useState("");
  const close = useCallback(() => setDialog(null), []);
  if (!space)
    return (
      <div className="flex h-9 items-center gap-2 px-2" aria-hidden>
        <Skeleton className="size-5 rounded-md" />
        <Skeleton className="h-3.5 w-24" />
      </div>
    );
  const base = `/spaces/${encodeURIComponent(space.id)}`;
  const page = (to: "home" | "chat") => {
    if (to === "chat") useMistyPanelStore.getState().show("chat");
    else openSpaceRoute(`${base}/home`);
  };
  const name = spaceNavigationName(space);
  const pageButton = (route: string, label: string, Icon: typeof House) => (
    <IconButton label={label} onClick={() => openSpaceRoute(`${base}/${route}`)}>
      <Icon {...toolbarIconProps} className="size-4" />
    </IconButton>
  );
  const actions = (
    <>
      <span className="mx-2.5 h-5 w-px shrink-0 self-center bg-white/[0.17]" aria-hidden="true" />
      <div
        className="flex items-center justify-self-center gap-2"
        data-browser-toolbar
        data-sidebar
      >
        <IconButton label={`${space.name || "Space"} home`} onClick={() => page("home")}>
          <House {...toolbarIconProps} className="size-4" />
        </IconButton>
        <IconButton label="Chat" aria-pressed={chatShown} onClick={() => page("chat")}>
          <MessagesSquare {...toolbarIconProps} className="size-4" />
        </IconButton>
        <AgentsPanelButton />
        {pageButton("notes", "Notes", NotebookPen)}
        {pageButton("drawings", "Drawings", PencilRuler)}
        {pageButton("library", "Files", Folder)}
      </div>
      <span className="mx-2.5 h-5 w-px shrink-0 self-center bg-white/[0.17]" aria-hidden="true" />
      <div className="flex items-center" data-browser-toolbar data-sidebar>
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
  );
  return (
    <Popover open={isSpacePanel(dialog)} onOpenChange={(next) => !next && close()}>
      <PopoverAnchor asChild>
        <div
          role="toolbar"
          aria-label={`${space.name || "Space"} controls`}
          className={cn(
            "flex h-full w-full min-w-0 items-center px-2",
            alignment === "left" && "justify-start",
            alignment === "center" && "justify-center",
            alignment === "right" && "justify-end",
          )}
        >
          <GlobalCreateSpaceDialog>
            {(create) => (
              <DropdownMenu onOpenChange={() => setError("")}>
                <DropdownMenuTrigger asChild>
                  <Pressable
                    aria-label={`${name}, Space menu`}
                    className="flex h-8 max-w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-sm text-cream-bright hover:bg-charcoal-hover data-[state=open]:bg-charcoal-hover"
                  >
                    <SpaceAvatar
                      space={space}
                      className="size-5 shrink-0 rounded-md"
                      fallbackClassName="text-[9px] font-semibold"
                    />
                    <span className="min-w-0 truncate font-medium">{name}</span>
                    <MenuChevron className="size-5 text-cream-muted" />
                  </Pressable>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="bottom"
                  align="start"
                  className="w-56 max-w-[calc(100vw-16px)]"
                >
                  <SpaceMenuItems
                    space={space}
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
              className="absolute inset-y-0 left-1/2 z-10 m-0 flex max-w-[60%] -translate-x-1/2 items-center truncate bg-[var(--workspace-tab-surface)] px-2 text-xs text-cream-muted"
              title={error}
            >
              {error}
            </p>
          )}
          {actions}
          <SpaceDialogs space={space} open={dialog} onClose={close} />
        </div>
      </PopoverAnchor>
    </Popover>
  );
}
