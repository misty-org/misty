import type { Space } from "@/api/spaces/dto/interfaces/types";
import { unreadActivityCountForSpace, useActivityStore } from "@/features/activity";
import { useAuth } from "@/features/auth";
import {
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type WorkspaceView,
} from "@/features/workspace";
import {
  appIconStrokeWidth,
  cn,
  NavigationTray,
  NavigationTrayItem,
  Pressable,
  Tooltip,
  TooltipContent,
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
function activeSpaceIdFromTab(tab: WorkspaceView | undefined): string {
  if (tab?.surfaceId !== "space") return "";
  const segment = tab.route.split(/[?#]/)[0].split("/")[2] ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}
const tileClass = "misty-space-rail-avatar";

/** The global navigator's Spaces toggle and the stack of Space avatars beneath it. */
export function WorkspaceSpaceNavigation({
  activeTab,
  onOpen,
}: {
  activeTab: WorkspaceView | undefined;
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
    <NavigationTray
      id="navigator-spaces"
      label="Spaces"
      groupLabel="Your Spaces"
      icon={
        <PanelsTopLeft
          className="size-4 shrink-0 justify-self-center"
          size={16}
          strokeWidth={appIconStrokeWidth}
          aria-hidden="true"
        />
      }
      active={Boolean(activeSpaceId)}
      open={open}
      onToggle={toggle}
    >
      {spaces.map((space) => {
        const unread = unreadActivityCountForSpace(activityItems, space.id);
        const active = space.id === activeSpaceId;
        const name = spaceNavigationName(space);
        return (
          <Tooltip key={space.id}>
            <TooltipTrigger asChild>
              <NavigationTrayItem>
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
              </NavigationTrayItem>
            </TooltipTrigger>
            <TooltipContent>{name}</TooltipContent>
          </Tooltip>
        );
      })}
      <GlobalCreateSpaceDialog>
        {(create) => (
          <Tooltip>
            <TooltipTrigger asChild>
              <NavigationTrayItem>
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
              </NavigationTrayItem>
            </TooltipTrigger>
            <TooltipContent>Create Space</TooltipContent>
          </Tooltip>
        )}
      </GlobalCreateSpaceDialog>
    </NavigationTray>
  );
}
