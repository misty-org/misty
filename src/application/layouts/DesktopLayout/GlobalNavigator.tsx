import { WebsiteGroupNavigator } from "@/features/browser-workspace/WebsiteGroupNavigator";
import { type RefObject } from "react";
import { dockLeaves, parseBrowserTabState, useWorkspaceStore } from "@/features/workspace";
import { cn } from "@/shared/ui";
import {
  NavigatorHeaderHomeButton,
  NavigatorHeaderSpacesButton,
  NavigatorHeaderAgentsButton,
  NavigatorHeaderFilesButton,
  NavigatorHeaderSearchButton,
} from "./NavigatorUtilityIsland";
import { NavigatorProfileBar } from "./NavigatorProfileBar";
import { ActivityMenu } from "./ActivityMenu";
import { NavigatorServerMenu } from "./NavigatorServerMenu";
import {
  navigatorTitlebarStripClass,
  navigatorHierarchyIslandClass,
  navigatorHierarchyActionClass,
} from "./styles";

export function GlobalNavigator(props: {
  profileAnchorRef: RefObject<HTMLButtonElement | null>;
  profileOpen: boolean;
  settingsOpen: boolean;
  suppressActiveTool?: boolean;
  onProfileClick: () => void;
  onSettingsClick: () => void;
  onStartWindowDrag?: (event: React.PointerEvent<HTMLElement>) => void;
  /** Present on desktop: drags (and double-click zooms) from the top band. */
  onTitlebarPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  const activeTab = useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((p) => p.id === state.layout.focusedPaneId) ?? panes[0];
    return pane?.tabs.find((tab) => tab.id === pane.activeTabId);
  });
  return (
    <nav
      className={cn(
        "relative z-20 flex h-full min-h-0 w-full select-none flex-col items-stretch [--navigation-primary-icon-slot:24px]",
        "overflow-hidden border-r border-charcoal-border bg-charcoal-workspace",
      )}
      aria-label="Primary"
      data-tour-target="navigation"
      onPointerDown={props.onStartWindowDrag}
    >
      {props.onTitlebarPointerDown ? (
        // The rail owns the titlebar band rather than being pushed below it, so
        // its right border runs the whole window height and the traffic-light
        // area stays a window-drag surface.
        <div
          className={navigatorTitlebarStripClass}
          onPointerDown={(event) => {
            event.stopPropagation();
            props.onTitlebarPointerDown?.(event);
          }}
        />
      ) : null}

      <div
        className="shrink-0 px-3 pb-1 pt-0.5"
        data-navigator-header="true"
        data-misty-window-drag-block="true"
      >
        <div className={navigatorHierarchyIslandClass} data-navigator-server-row="true">
          <NavigatorServerMenu onSettingsClick={props.onSettingsClick} />
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <NavigatorHeaderSearchButton className={navigatorHierarchyActionClass} />
            <ActivityMenu className={navigatorHierarchyActionClass} />
          </div>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        data-misty-window-drag-block="true"
      >
        <div className="grid content-start gap-1 overflow-y-auto px-3 pb-2">
          <NavigatorHeaderHomeButton
            path="/browser"
            active={
              activeTab?.surfaceId === "browser" && !parseBrowserTabState(activeTab.state).websiteId
            }
          />
          <NavigatorHeaderAgentsButton path="/agents" active={activeTab?.surfaceId === "agents"} />
          <NavigatorHeaderFilesButton path="/files" active={activeTab?.surfaceId === "files"} />
          <NavigatorHeaderSpacesButton active={activeTab?.surfaceId === "space"} />
          <div className="mt-3">
            <WebsiteGroupNavigator />
          </div>
        </div>
      </div>

      <NavigatorProfileBar
        profileAnchorRef={props.profileAnchorRef}
        profileOpen={props.profileOpen}
        settingsOpen={props.settingsOpen}
        onProfileClick={props.onProfileClick}
        onSettingsClick={props.onSettingsClick}
      />
    </nav>
  );
}
