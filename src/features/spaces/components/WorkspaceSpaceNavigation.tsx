import type { Space } from "@/api/spaces/dto/interfaces/types";
import { unreadActivityCountForSpace, useActivityStore } from "@/features/activity";
import { useAuth } from "@/features/auth";
import {
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type WorkspaceTab,
} from "@/features/workspace";
import {
  appIconStrokeWidth,
  cn,
  navigationMenuLinkClass,
  Pressable,
  TooltipHint,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui";
import { PanelsTopLeft, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobalCreateSpaceDialog } from "../GlobalCreateSpaceDialog";
import { spaceLandingRoute } from "../navigation";
import { useSpacesStore } from "../store/useSpacesStore";
import { spaceNavigationName } from "../defaultSpace";
import { SpaceAvatar } from "./SpaceAvatar";

const openStorageKey = "misty:navigator-spaces-open";
/** The stack stays open until the user closes it, across restarts. */
function usePersistentOpen() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(openStorageKey) !== "false";
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((current) => {
      try {
        localStorage.setItem(openStorageKey, String(!current));
      } catch {
        // Storage can be unavailable; the toggle still works for this session.
      }
      return !current;
    });
  return [open, toggle] as const;
}
function activeSpaceIdFromTab(tab: WorkspaceTab | undefined): string {
  if (tab?.surfaceId !== "space") return "";
  const segment = tab.route.split(/[?#]/)[0].split("/")[2] ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}
const tileClass = "misty-space-rail-control misty-space-rail-avatar relative p-0";

/** The global navigator's Spaces toggle and the stack of Space avatars beneath it. */
export function WorkspaceSpaceNavigation({
  activeTab,
  onOpen,
}: {
  activeTab: WorkspaceTab | undefined;
  onOpen?: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const activityItems = useActivityStore((state) => state.allItems);
  const [open, toggle] = usePersistentOpen();
  const activeSpaceId = activeSpaceIdFromTab(activeTab);
  const openSpace = (space: Space) => {
    const surface = workspaceSurfaceFromRoute(spaceLandingRoute(space.id, user?.id));
    if (!surface) return;
    navigate(useWorkspaceStore.getState().openDestination(surface).route, { replace: true });
    onOpen?.();
  };
  return (
    <div
      data-spaces-tray="true"
      className={cn("grid min-w-0 rounded-lg", (open || activeSpaceId) && "bg-charcoal-hover")}
    >
      <TooltipHint content={open ? "Hide Spaces" : "Show Spaces"}>
        <Pressable
          className={cn(
            navigationMenuLinkClass,
            "w-full",
            (open || activeSpaceId) && "text-cream-bright",
          )}
          aria-label="Spaces"
          aria-expanded={open}
          aria-controls="navigator-spaces"
          data-active={activeSpaceId ? "true" : undefined}
          data-spaces-toggle="true"
          onClick={toggle}
        >
          <PanelsTopLeft
            className="size-4 shrink-0 justify-self-center"
            size={16}
            strokeWidth={appIconStrokeWidth}
            aria-hidden="true"
          />
          <span>Spaces</span>
        </Pressable>
      </TooltipHint>
      <div
        id="navigator-spaces"
        data-spaces-stack="true"
        data-open={open ? "true" : "false"}
        inert={!open}
        // Height only: the clipped row already hides a closed stack, and fading
        // it makes WebKit composite the rail and re-rasterize its glyphs.
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <TooltipProvider delayDuration={350}>
          <div
            className="flex min-h-0 items-center gap-1.5 overflow-hidden"
            aria-label="Your Spaces"
            role="group"
          >
            {spaces.map((space) => {
              const unread = unreadActivityCountForSpace(activityItems, space.id);
              const active = space.id === activeSpaceId;
              const name = spaceNavigationName(space);
              return (
                <Tooltip key={space.id}>
                  <TooltipTrigger asChild>
                    <Pressable
                      className={tileClass}
                      aria-label={unread > 0 ? `${name}, ${unread} unread` : name}
                      aria-current={active ? "page" : undefined}
                      data-navigation-destination="true"
                      data-active={active ? "true" : undefined}
                      onClick={() => openSpace(space)}
                    >
                      <SpaceAvatar space={space} />
                      {unread > 0 ? (
                        <span
                          aria-hidden="true"
                          className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-notification-red ring-2 ring-charcoal-workspace"
                        />
                      ) : null}
                    </Pressable>
                  </TooltipTrigger>
                  <TooltipContent>{name}</TooltipContent>
                </Tooltip>
              );
            })}
            <GlobalCreateSpaceDialog>
              {(create) => (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Pressable
                      className={cn(
                        tileClass,
                        "grid place-items-center rounded-lg border border-dashed border-charcoal-active text-cream-muted",
                      )}
                      aria-label="Create Space"
                      onClick={create}
                    >
                      <Plus size={16} strokeWidth={appIconStrokeWidth} aria-hidden="true" />
                    </Pressable>
                  </TooltipTrigger>
                  <TooltipContent>Create Space</TooltipContent>
                </Tooltip>
              )}
            </GlobalCreateSpaceDialog>
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
