import type { Space } from "@/api/spaces/dto/interfaces/types";
import { unreadActivityCountForSpace, useActivityStore } from "@/features/activity";
import { GlobalCreateSpaceDialog, SpaceAvatar, SpaceRowActions } from "@/features/spaces";
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
  navigationDisclosureChevronClass,
  navigationDisclosureLabelClass,
} from "@/shared/ui";
import { ChevronDown, Plus } from "lucide-react";
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
  const activeName = props.activeSpace?.name ?? "Misty";
  const activeUnread = props.activeSpace
    ? unreadActivityCountForSpace(activityItems, props.activeSpace.id)
    : 0;
  const switcherLabel = props.activeSpace
    ? `Switch Space, current Space: ${props.activeSpace.name}${activeUnread > 0 ? `, ${activeUnread} unread` : ""}`
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
                      "misty-navigator-row-target flex h-9 w-full max-w-full min-w-0 items-center",
                      "gap-2.5 rounded-md border-0 bg-transparent px-2.5 text-left transition-colors",
                      "hover:bg-charcoal-card/60",
                      navigatorFocusRingClass,
                    )}
                    aria-label={switcherLabel}
                    data-misty-window-drag-block="true"
                    data-space-menu-open={menuOpen ? "true" : "false"}
                  >
                    <span className="relative grid size-7 shrink-0 place-items-center">
                      {props.activeSpace ? (
                        <>
                          <SpaceAvatar
                            space={props.activeSpace}
                            className="size-7 rounded-md border-0 bg-transparent"
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
                          className="size-7 rounded-md border border-charcoal-border bg-charcoal-card"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span
                      className={cn(
                        navigationDisclosureLabelClass,
                        "max-w-[calc(100%_-_2.375rem)]",
                      )}
                    >
                      <OverflowFadeText
                        className="min-w-0 overflow-hidden whitespace-nowrap text-base font-semibold text-cream"
                        data-active-space-name="true"
                        title={activeName}
                      >
                        {activeName}
                      </OverflowFadeText>
                      <ChevronDown
                        size={16}
                        className={cn(
                          navigationDisclosureChevronClass,
                          "text-cream-muted transition-transform duration-150 motion-reduce:transition-none",
                          menuOpen && "rotate-180",
                        )}
                        strokeWidth={2}
                        aria-hidden="true"
                        data-chevron-placement="inline"
                      />
                    </span>
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Switch Space</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenuContent align="start" sideOffset={6} className="w-[304px]">
            <DropdownMenuLabel>Spaces</DropdownMenuLabel>
            <div className="misty-transient-scrollbar grid max-h-[320px] gap-1 overflow-y-auto">
              {props.spaces.map((space) => {
                const active = space.id === props.activeSpaceId;
                const unread = unreadActivityCountForSpace(activityItems, space.id);
                return (
                  <div className="group/space-menu-row relative" key={space.id}>
                    <DropdownMenuItem
                      className={cn(
                        "h-8 gap-2.5 overflow-hidden pr-[94px]",
                        "group-hover/space-menu-row:bg-charcoal-hover",
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
                        title={space.name}
                      >
                        {space.name}
                      </OverflowFadeText>
                      {unread > 0 ? <span className="sr-only">{unread} unread</span> : null}
                    </DropdownMenuItem>
                    <div
                      className="pointer-events-auto absolute inset-y-0 right-1 z-10 flex w-[86px] items-center justify-end opacity-100"
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
