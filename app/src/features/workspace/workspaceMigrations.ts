import { mapDockTabs } from "./dockTree";
import { browserTabTitle, parseBrowserTabState, type WorkspaceLayout } from "./model";
import { workspaceSurfaceFromRoute } from "./routeSurface";

export function migrateBrowserTabs(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    ...layout,
    root: mapDockTabs(layout.root, (tab) =>
      tab.surfaceId === "browser"
        ? {
            ...tab,
            title:
              tab.title && tab.title !== "Browser"
                ? tab.title
                : browserTabTitle(parseBrowserTabState(tab.state).url),
            state: parseBrowserTabState(tab.state),
          }
        : tab,
    ),
  };
}

export function migrateSpaceToolTabs(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    ...layout,
    root: mapDockTabs(layout.root, (tab) => {
      if (tab.surfaceId !== "space") return tab;
      const request = workspaceSurfaceFromRoute(tab.route);
      if (!request || request.surfaceId !== "space") return tab;
      return {
        ...tab,
        groupKey: request.groupKey,
        instanceKey: request.instanceKey ?? tab.instanceKey,
        title: request.title,
      };
    }),
  };
}
