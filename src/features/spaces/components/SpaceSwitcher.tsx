import type { Space } from "@/api/spaces/dto/interfaces/types";
import { unreadActivityCountForSpace, useActivityStore } from "@/features/activity";
import { GlobalCreateSpaceDialog, SpaceAvatar, spaceNavigationName } from "@/features/spaces";
import { spaceLandingRoute } from "@/features/spaces/navigation";

import {
  Button,
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
  NavigationChevron,
} from "@/shared/ui";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
const navigatorHierarchyTriggerClass =
  "flex items-center gap-2 h-auto rounded-lg border-0 bg-transparent px-2 py-2 text-left text-cream hover:bg-charcoal-hover focus-visible:ring-2 focus-visible:ring-cream-muted";

export function SpaceSwitcher(props: {
  variant?: "default" | "pull-tab";
  activeSpace: Space | undefined;
  activeSpaceId: string;
  canAddSpace: boolean;
  spaces: Space[];
  userId: string;
}) {
  const pullTab = props.variant === "pull-tab";
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const pullStart = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const activityItems = useActivityStore((state) => state.allItems);
  const activeName = props.activeSpace ? spaceNavigationName(props.activeSpace) : "Misty";
  const activeUnread = props.activeSpace
    ? unreadActivityCountForSpace(activityItems, props.activeSpace.id)
    : 0;
  const switcherLabel = props.activeSpace
    ? `Switch Space, current Space: ${spaceNavigationName(props.activeSpace)}${activeUnread > 0 ? `, ${activeUnread} unread` : ""}`
    : "Choose a Space";

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node) {
        if (
          triggerRef.current?.contains(target) ||
          contentRef.current?.contains(target) ||
          (target instanceof Element && target.closest('[data-slot="popover-content"]'))
        ) {
          return;
        }
      }
      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    const handleBlur = () => {
      setMenuOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
    };
  }, [menuOpen]);

  const switchSpace = (space: Space) => {
    setMenuOpen(false);
    if (space.id === props.activeSpaceId) return;
    navigate(spaceLandingRoute(space.id, props.userId, location.pathname));
  };

  return (
    <GlobalCreateSpaceDialog>
      {(openCreateSpaceDialog) => (
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
          <TooltipProvider delayDuration={450}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    ref={triggerRef}
                    type="button"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      event.currentTarget.focus();
                      pullStart.current = pullTab ? event.clientX : event.clientY;
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                    }}
                    onPointerUp={(event) => {
                      if (pullStart.current === null) return;
                      const pulled =
                        (pullTab
                          ? pullStart.current - event.clientX
                          : event.clientY - pullStart.current) > 16;
                      pullStart.current = null;
                      setMenuOpen((value) => pulled || !value);
                    }}
                    onPointerCancel={() => {
                      pullStart.current = null;
                    }}
                    style={{ touchAction: "none" }}
                    className={
                      pullTab
                        ? "space-pull-tab space-pull-avatar"
                        : cn(navigatorHierarchyTriggerClass, "w-fit max-w-full")
                    }
                    aria-label={switcherLabel}
                    data-misty-window-drag-block="true"
                    data-space-menu-open={menuOpen ? "true" : "false"}
                  >
                    <span className="relative flex size-6 shrink-0 items-center justify-center">
                      {props.activeSpace ? (
                        <>
                          <SpaceAvatar
                            space={props.activeSpace}
                            className="size-6 border-0 bg-transparent"
                            fallbackClassName="text-[10px] font-bold"
                          />
                          {activeUnread > 0 ? (
                            <span
                              className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-notification-red ring-2 ring-charcoal-workspace"
                              aria-hidden="true"
                            />
                          ) : null}
                        </>
                      ) : (
                        <span
                          className="size-6 rounded-md border border-charcoal-border bg-charcoal-card"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    {!pullTab && (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <OverflowFadeText
                          className="min-w-0 max-w-[150px] overflow-hidden whitespace-nowrap text-sm font-semibold text-inherit tracking-[-0.015em]"
                          data-active-space-name="true"
                          title={activeName}
                        >
                          {activeName}
                        </OverflowFadeText>
                        <NavigationChevron open={menuOpen} />
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side={pullTab ? "left" : "top"}>
                {activeName} · Switch Space
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenuContent
            ref={contentRef}
            align="start"
            side={pullTab ? "left" : "bottom"}
            sideOffset={6}
            className="w-[240px] grid-cols-[minmax(0,1fr)]"
          >
            <DropdownMenuLabel>Spaces</DropdownMenuLabel>
            <div className="misty-transient-scrollbar grid max-h-[320px] min-w-0 grid-cols-[minmax(0,1fr)] gap-1 overflow-x-hidden overflow-y-auto">
              {props.spaces.map((space) => {
                const active = space.id === props.activeSpaceId;
                const unread = unreadActivityCountForSpace(activityItems, space.id);
                return (
                  <div className="min-w-0" key={space.id}>
                    <DropdownMenuItem
                      className={cn(
                        "h-8 min-w-0 gap-2.5 overflow-hidden",
                        active && "bg-charcoal-hover text-cream",
                      )}
                      aria-current={active ? "page" : undefined}
                      onSelect={() => switchSpace(space)}
                    >
                      <span className="relative grid size-6 shrink-0 place-items-center">
                        <SpaceAvatar space={space} className="size-6 border-0 bg-transparent" />
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
              onSelect={() => {
                setMenuOpen(false);
                openCreateSpaceDialog();
              }}
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
