import type { Space } from "@/api/spaces/dto/interfaces/types";
import { unreadActivityCountForSpace, useActivityStore } from "@/features/activity";
import {
  GlobalCreateSpaceDialog,
  SpaceAvatar,
  SpaceRowActions,
  spaceNavigationName,
} from "@/features/spaces";
import { spaceLandingRoute } from "@/features/spaces/navigation";
import { useWorkspaceStore } from "@/features/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  OverflowFadeText,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  navigationMenuRowClass,
  navigationMenuDisclosureLayoutClass,
  NavigationChevron,
} from "@/shared/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { navigatorFocusRingClass } from "./styles";

export function GlobalSpaceSwitcher(props: {
  activeSpace: Space | undefined;
  activeSpaceId: string;
  canAddSpace: boolean;
  spaces: Space[];
  userId: string;
}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const activityItems = useActivityStore((state) => state.allItems);
  const activeName = props.activeSpace ? spaceNavigationName(props.activeSpace) : "Misty";
  const activeUnread = props.activeSpace
    ? unreadActivityCountForSpace(activityItems, props.activeSpace.id)
    : 0;
  const switcherLabel = props.activeSpace
    ? `Switch Space, current Space: ${spaceNavigationName(props.activeSpace)}${activeUnread > 0 ? `, ${activeUnread} unread` : ""}`
    : "Choose a Space";

  const switchSpace = (space: Space) => {
    if (space.id === props.activeSpaceId) return;
    useWorkspaceStore.getState().setScope(`space:${space.id}`);
    navigate(spaceLandingRoute(space.id, props.userId));
  };

  return (
    <GlobalCreateSpaceDialog>
      {(openCreateSpaceDialog) => (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <TooltipProvider delayDuration={450}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      navigationMenuRowClass,
                      navigationMenuDisclosureLayoutClass,
                      "flex-1 max-w-[calc(100%_-_2.5rem)]",
                      navigatorFocusRingClass,
                    )}
                    aria-label={switcherLabel}
                    data-misty-window-drag-block="true"
                    data-space-menu-open={menuOpen ? "true" : "false"}
                  >
                    <span className="relative flex size-[18px] shrink-0 items-center justify-center">
                      {props.activeSpace ? (
                        <>
                          <SpaceAvatar
                            space={props.activeSpace}
                            className="size-[18px] rounded border-0 bg-transparent"
                          />
                          {activeUnread > 0 ? (
                            <span
                              className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-notification-red ring-2 ring-charcoal-workspace"
                              aria-hidden="true"
                            />
                          ) : null}
                        </>
                      ) : (
                        <span
                          className="size-[18px] rounded border border-charcoal-border bg-charcoal-card"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="flex min-w-0 items-center gap-1">
                      <OverflowFadeText
                        className="min-w-0 max-w-[150px] overflow-hidden whitespace-nowrap text-[13px] font-medium text-cream"
                        data-active-space-name="true"
                        title={activeName}
                      >
                        {activeName}
                      </OverflowFadeText>
                      <NavigationChevron open={menuOpen} />
                    </span>
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Switch Space</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className="w-[240px] grid-cols-[minmax(0,1fr)]"
          >
            <DropdownMenuLabel>Spaces</DropdownMenuLabel>
            <div className="misty-transient-scrollbar grid max-h-[320px] min-w-0 grid-cols-[minmax(0,1fr)] gap-1 overflow-x-hidden overflow-y-auto">
              {props.spaces.map((space) => {
                const active = space.id === props.activeSpaceId;
                const unread = unreadActivityCountForSpace(activityItems, space.id);
                return (
                  <div className="group/space-menu-row relative min-w-0" key={space.id}>
                    <DropdownMenuItem
                      className={cn(
                        "h-8 min-w-0 gap-2.5 overflow-hidden",
                        "group-hover/space-menu-row:bg-charcoal-hover",
                        "group-has-[[data-state=open]]/space-menu-row:bg-charcoal-hover",
                        active && "bg-charcoal-hover text-cream",
                      )}
                      aria-current={active ? "page" : undefined}
                      onSelect={() => switchSpace(space)}
                    >
                      <span className="relative grid size-6 shrink-0 place-items-center">
                        <SpaceAvatar
                          space={space}
                          className="size-6 rounded-md border-0 bg-transparent"
                        />
                        {unread > 0 ? (
                          <span
                            className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-notification-red ring-2 ring-charcoal-card"
                            aria-hidden="true"
                          />
                        ) : null}
                      </span>
                      <OverflowFadeText
                        className="block min-w-0 flex-1 overflow-hidden whitespace-nowrap"
                        data-space-name={space.id}
                        title={spaceNavigationName(space)}
                      >
                        {spaceNavigationName(space)}
                      </OverflowFadeText>
                      {unread > 0 ? <span className="sr-only">{unread} unread</span> : null}
                    </DropdownMenuItem>
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-y-0 right-1 z-10 flex w-[86px] items-center justify-end bg-charcoal-hover opacity-0 transition-opacity",
                        "before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-[18px] before:bg-gradient-to-r before:from-transparent before:to-charcoal-hover",
                        "group-hover/space-menu-row:pointer-events-auto group-hover/space-menu-row:opacity-100",
                        "group-focus-within/space-menu-row:pointer-events-auto group-focus-within/space-menu-row:opacity-100",
                        "has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100",
                      )}
                      data-space-row-actions={space.id}
                    >
                      <SpaceRowActions space={space} />
                    </div>
                  </div>
                );
              })}
              {props.spaces.length === 0 ? (
                <p className="px-2 py-2 text-sm text-cream-muted">No Spaces available.</p>
              ) : null}
            </div>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!props.canAddSpace}
              title={props.canAddSpace ? undefined : "Space limit reached"}
              onSelect={openCreateSpaceDialog}
            >
              <Plus size={14} aria-hidden="true" />
              New Space
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </GlobalCreateSpaceDialog>
  );
}
