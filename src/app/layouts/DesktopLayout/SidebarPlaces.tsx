import type { WorkspaceView } from "@/features/app-windows";
import { newWebTabRoute } from "@/features/browser";
import { AppsLauncher, useAppLauncher, useWindowSpace } from "@/features/spaces";
import { useShortcutHandler } from "@/features/shortcuts";
import { PlaceTile, PlaceTiles, spaceIcons } from "@misty/ui";
import { useFocusedRoute } from "./SpaceNavigator";
import { openWorkspaceRoute, openWorkspaceRouteIn } from "./space_navigation";

const filesRoute = "/agents?view=files";
const FilesIcon = spaceIcons.files;
const AppsIcon = spaceIcons.apps;
const BrowserIcon = spaceIcons.browser;
const ExploreIcon = spaceIcons.explore;

export function SidebarPlaces(props: { onOpen(view: WorkspaceView): void }) {
  const space = useWindowSpace();
  const focused = useFocusedRoute();
  const route = focused.split("?")[0];
  const explore = space ? `/spaces/${encodeURIComponent(space.id)}/explore` : "";
  const appsOpen = useAppLauncher((state) => state.open);
  const openFiles = () => openWorkspaceRouteIn(filesRoute, "tab", props.onOpen);
  const openApps = () => useAppLauncher.getState().setOpen(true);
  const openBrowser = () => openWorkspaceRouteIn(newWebTabRoute(), "tab", props.onOpen);
  const openExplore = () => {
    if (explore) openWorkspaceRouteIn(explore, "tab", props.onOpen);
  };
  useShortcutHandler("app.open_files", openFiles, Boolean(space));
  useShortcutHandler("app.open_apps", openApps, Boolean(space));
  useShortcutHandler("app.open_browser", openBrowser);
  useShortcutHandler("app.open_explore", openExplore, Boolean(space));

  return (
    <>
      <PlaceTiles label="Places" className="mt-1.5">
        <PlaceTile label="Files" selected={!appsOpen && focused === filesRoute} onClick={openFiles}>
          <FilesIcon aria-hidden="true" />
        </PlaceTile>
        <PlaceTile
          data-tour="rail-apps"
          label="Apps"
          selected={appsOpen}
          disabled={!space}
          onClick={openApps}
        >
          <AppsIcon aria-hidden="true" />
        </PlaceTile>
        <PlaceTile
          label="Browser"
          selected={!appsOpen && route.startsWith("/browser/")}
          onClick={openBrowser}
        >
          <BrowserIcon aria-hidden="true" />
        </PlaceTile>
        <PlaceTile
          data-tour="sidebar-explore"
          label="Explore"
          selected={!appsOpen && Boolean(explore) && route === explore}
          disabled={!explore}
          onClick={openExplore}
        >
          <ExploreIcon aria-hidden="true" />
        </PlaceTile>
      </PlaceTiles>
      {space ? (
        <AppsLauncher
          spaceId={space.id}
          onOpen={(target) => openWorkspaceRoute(target, props.onOpen)}
        />
      ) : null}
    </>
  );
}
