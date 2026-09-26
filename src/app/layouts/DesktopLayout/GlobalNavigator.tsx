import { WebsiteGroupNavigator } from "@/features/browser-workspace/WebsiteGroupNavigator";
import { useState, type RefObject } from "react";
import { Globe, ChevronDown } from "lucide-react";
import { isSideDock, type DockPosition } from "@/features/app-shell/dockingLayout";
import { dockLeaves, parseBrowserTabState, useWorkspaceStore } from "@/features/workspace";
import { cn, Button, Popover, PopoverTrigger, PopoverContent } from "@/shared/ui";
import {
  NavigatorHeaderHomeButton,
  NavigatorHeaderAgentsButton,
  NavigatorHeaderFilesButton,
  NavigatorHeaderSearchButton,
} from "./NavigatorUtilityIsland";
import { NavigatorProfileBar } from "./NavigatorProfileBar";
import { WorkspaceSpaceNavigation } from "@/features/spaces";
import { ActivityMenu } from "./ActivityMenu";
import { NavigatorServerMenu } from "./NavigatorServerMenu";
import {
  navigatorTitlebarStripClass,
  navigatorHeaderRowClass,
  navigatorHierarchyActionClass,
} from "./styles";

export function GlobalNavigator(props: {
  position?: DockPosition;
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
  const horizontal = !isSideDock(props.position ?? "left");
  const [groupsOpen, setGroupsOpen] = useState(false);
  const activeTab = useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((p) => p.id === state.layout.focusedPaneId) ?? panes[0];
    return pane?.tabs.find((tab) => tab.id === pane.activeTabId);
  });
  return (
    <nav
      className={cn(
        "misty-navigation-icons relative z-20 flex h-full min-h-0 w-full select-none flex-col items-stretch [--navigation-row-height:32px] [--navigation-row-font-size:14px]",
        "misty-global-navigator overflow-hidden border-charcoal-border bg-charcoal-workspace",
      )}
      data-dock-position={props.position ?? "left"}
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
        <div className={navigatorHeaderRowClass} data-navigator-server-row="true">
          <NavigatorServerMenu onSettingsClick={props.onSettingsClick} />
          <div className="ml-auto flex shrink-0 items-center">
            <NavigatorHeaderSearchButton className={navigatorHierarchyActionClass} />
            <ActivityMenu className={navigatorHierarchyActionClass} />
          </div>
        </div>
      </div>

      <div
        className="misty-navigator-body flex min-h-0 flex-1 flex-col overflow-hidden"
        data-misty-window-drag-block="true"
      >
        <div className="misty-navigator-items grid content-start gap-0.5 overflow-y-auto px-3 pb-2">
          <NavigatorHeaderHomeButton
            path="/browser"
            active={
              activeTab?.surfaceId === "browser" && !parseBrowserTabState(activeTab.state).websiteId
            }
          />
          <NavigatorHeaderAgentsButton path="/agents" active={activeTab?.surfaceId === "agents"} />
          <NavigatorHeaderFilesButton path="/files" active={activeTab?.surfaceId === "files"} />
          <WorkspaceSpaceNavigation activeTab={activeTab} />
          {horizontal ? (
            <Popover open={groupsOpen} onOpenChange={setGroupsOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  className="shrink-0 gap-2 text-xs text-cream-muted"
                  aria-label="Website groups"
                >
                  <Globe size={16} />
                  Groups
                  <ChevronDown size={12} />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side={props.position === "bottom" ? "top" : "bottom"}
                align="start"
                className="max-h-[min(520px,70vh)] w-72 overflow-y-auto p-2"
              >
                <WebsiteGroupNavigator onOpen={() => setGroupsOpen(false)} />
              </PopoverContent>
            </Popover>
          ) : (
            <div className="mt-3">
              <WebsiteGroupNavigator />
            </div>
          )}
        </div>
      </div>

      <NavigatorProfileBar
        compact={horizontal}
        profileAnchorRef={props.profileAnchorRef}
        profileOpen={props.profileOpen}
        settingsOpen={props.settingsOpen}
        onProfileClick={props.onProfileClick}
        onSettingsClick={props.onSettingsClick}
      />
    </nav>
  );
}
