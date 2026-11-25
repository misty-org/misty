import { Plus } from "lucide-react";
import { switchSpaceWindow, type WorkspaceView } from "@/features/app-windows";
import { newWebTabRoute } from "@/features/browser";
import {
  AppsLauncher,
  GlobalCreateSpaceDialog,
  SpaceAvatar,
  useAppLauncher,
  useSpacesStore,
  useWindowSpace,
} from "@/features/spaces";
import { useShortcutHandler } from "@/features/shortcuts";
import { cn, SpaceRail, SpaceRailItem, spaceIcons, Surface } from "@misty/ui";
import { useAttentionCounts, useSpaceMentionCounting } from "./attention";
import { AccountAvatar } from "./NavRail";
import { choosePlace, usePlace, useSharedSpaces, useSpacesSideFollowsSpaces } from "./place_store";
import { useSidebarPlaceColor } from "./sidebar_place_color";
import { useFocusedRoute } from "./SpaceNavigator";
import { openWorkspaceRoute, openWorkspaceRouteIn } from "./space_navigation";

const filesRoute = "/agents?view=files";
const FilesIcon = spaceIcons.files;
const AppsIcon = spaceIcons.apps;
const BrowserIcon = spaceIcons.browser;
const ExploreIcon = spaceIcons.explore;

export function SpaceRailNav(props: {
  onOpen(view: WorkspaceView): void;
  side: "left" | "right";
}) {
  const place = usePlace();
  const space = useWindowSpace();
  const shared = useSharedSpaces();
  const counts = useAttentionCounts();
  const invitations = useSpacesStore((state) => state.invitations.length);
  const focused = useFocusedRoute();
  const route = focused.split("?")[0];
  useSpacesSideFollowsSpaces();
  useSpaceMentionCounting();
  const placeColor = useSidebarPlaceColor();
  const explore = space ? `/spaces/${encodeURIComponent(space.id)}/explore` : "";
  const openFiles = () => openWorkspaceRoute(filesRoute, props.onOpen);
  const openBrowser = () => openWorkspaceRouteIn(newWebTabRoute(), "tab", props.onOpen);
  const openExplore = () => {
    if (explore) openWorkspaceRoute(explore, props.onOpen);
  };
  const appsOpen = useAppLauncher((state) => state.open);
  const openApps = () => useAppLauncher.getState().setOpen(true);
  useShortcutHandler("app.open_files", openFiles, Boolean(space));
  useShortcutHandler("app.open_apps", openApps, Boolean(space));
  useShortcutHandler("app.open_browser", openBrowser);
  useShortcutHandler("app.open_explore", openExplore, Boolean(space));

  return (
    <Surface
      tone="chrome"
      className={cn(
        "flex min-h-0 flex-none",
        props.side === "right"
          ? "pr-[var(--pane-frame,calc(var(--spacing)*1.5))]"
          : "pl-[var(--pane-frame,calc(var(--spacing)*1.5))]",
      )}
    >
    <Surface tone="sidebar" place={placeColor} className="flex min-h-0 flex-1 flex-col">
      <div
        className="h-(--ui-header) w-16 shrink-0"
        data-misty-window-titlebar-region="true"
        aria-hidden="true"
      />
    <SpaceRail
      label="Spaces"
      className="min-h-0 flex-1"
      start={
        <>
          <SpaceRailItem
            label="Personal"
            selected={place === "personal"}
            count={counts.personal}
            waiting={counts.personalWaiting}
            onSelect={() => choosePlace("personal")}
          >
            <AccountAvatar shape="tile" />
          </SpaceRailItem>
          <SpaceRailItem label="Files" selected={!appsOpen && focused === filesRoute} onSelect={openFiles}>
            <FilesIcon aria-hidden="true" />
          </SpaceRailItem>
          {space ? (
            <>
              <SpaceRailItem
                data-tour="rail-apps"
                label="Apps"
                selected={appsOpen}
                onSelect={openApps}
              >
                <AppsIcon aria-hidden="true" />
              </SpaceRailItem>
              <AppsLauncher
                spaceId={space.id}
                onOpen={(target) => openWorkspaceRoute(target, props.onOpen)}
              />
            </>
          ) : null}
          <SpaceRailItem
            label="Browser"
            selected={!appsOpen && route.startsWith("/browser/")}
            onSelect={openBrowser}
          >
            <BrowserIcon aria-hidden="true" />
          </SpaceRailItem>
          <SpaceRailItem
            data-tour="sidebar-explore"
            label="Explore"
            selected={!appsOpen && Boolean(explore) && route === explore}
            onSelect={openExplore}
          >
            <ExploreIcon aria-hidden="true" />
          </SpaceRailItem>
        </>
      }
    >
      {shared.map((item) => {
        const attention = counts.bySpace.get(item.id);
        return (
          <SpaceRailItem
            key={item.id}
            label={item.name}
            selected={place === "spaces" && space?.id === item.id}
            count={attention?.count}
            waiting={attention?.waiting}
            onSelect={() => switchSpaceWindow(item.id, false)}
          >
            <SpaceAvatar space={item} />
          </SpaceRailItem>
        );
      })}
      <GlobalCreateSpaceDialog>
        {(create) => (
          <SpaceRailItem label="New Space" count={invitations} onSelect={create}>
            <Plus aria-hidden="true" />
          </SpaceRailItem>
        )}
      </GlobalCreateSpaceDialog>
    </SpaceRail>
    </Surface>
    </Surface>
  );
}
