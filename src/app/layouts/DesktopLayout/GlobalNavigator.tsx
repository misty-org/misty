import type { DockPosition } from "@/features/app-shell/dockingLayout";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { cn, TooltipSideProvider } from "@/shared/ui";
import {
  NavigatorHeaderHomeButton,
  NavigatorHeaderAgentsButton,
  NavigatorHeaderFilesButton,
  NavigatorHeaderSearchButton,
  NavigatorHomeLink,
  NavigatorScheduledLink,
} from "./NavigatorUtilityIsland";
import { useLocation } from "react-router-dom";
import { NavigatorProfileBar } from "./NavigatorProfileBar";
import { WorkspaceSpaceNavigation } from "@/features/spaces";
import { ActivityMenu } from "./ActivityMenu";
import { NavigatorServerMenu } from "./NavigatorServerMenu";
import { useRef } from "react";
import { NavigatorEdgeMarkers } from "./NavigatorEdgeMarkers";
import {
  navigatorTitlebarStripClass,
  navigatorHeaderRowClass,
  navigatorHierarchyActionClass,
} from "./styles";

export function GlobalNavigator(props: {
  position?: DockPosition;
  profileOpen: boolean;
  onProfileOpenChange: (open: boolean) => void;
  onOpenAccountSettings: () => void;
  settingsOpen: boolean;
  syncControl?: React.ReactNode;
  suppressActiveTool?: boolean;
  onSettingsClick: () => void;
  onStartWindowDrag?: (event: React.PointerEvent<HTMLElement>) => void;
  /** Present on desktop: drags (and double-click zooms) from the top band. */
  onTitlebarPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  const navigatorRef = useRef<HTMLElement>(null);
  const pathname = useLocation().pathname;
  const onHome = pathname === "/home";
  const focusedTab = useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((p) => p.id === state.layout.focusedPaneId) ?? panes[0];
    return pane?.tabs.find((tab) => tab.id === pane.activeTabId);
  });
  // Standalone pages such as Home and Activity cover the workspace, so no app is current.
  const activeTab = props.suppressActiveTool ? undefined : focusedTab;
  return (
    <TooltipSideProvider
      value={
        ({ left: "right", right: "left", top: "bottom", bottom: "top" } as const)[
          props.position ?? "left"
        ]
      }
    >
      <nav
        ref={navigatorRef}
        className={cn(
          "misty-navigation-icons relative z-20 flex h-full min-h-0 w-full",
          "select-none flex-col items-stretch [--navigation-row-height:32px]",
          "[--navigation-row-font-size:14px]",
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
          </div>
        </div>
        <div aria-hidden="true" className="misty-navigator-divider" />

        <div
          className="misty-navigator-body flex min-h-0 flex-1 flex-col overflow-hidden"
          data-misty-window-drag-block="true"
        >
          <div className="misty-navigator-items grid content-start gap-0.5 overflow-y-auto px-3 pb-2">
            <NavigatorHomeLink active={onHome} />
            <NavigatorHeaderHomeButton
              path="/browser"
              active={activeTab?.surfaceId === "browser"}
            />
            <NavigatorHeaderAgentsButton
              path="/agents"
              active={activeTab?.surfaceId === "agents"}
            />
            <NavigatorScheduledLink active={activeTab?.surfaceId === "scheduled"} />
            <NavigatorHeaderFilesButton path="/files" active={activeTab?.surfaceId === "files"} />
            <WorkspaceSpaceNavigation activeTab={activeTab} />
          </div>
        </div>
        <NavigatorProfileBar
          utilityControls={
            <>
              <NavigatorHeaderSearchButton className={navigatorHierarchyActionClass} />
              <ActivityMenu className={navigatorHierarchyActionClass} />
              {props.syncControl}
            </>
          }
          profileOpen={props.profileOpen}
          settingsOpen={props.settingsOpen}
          onProfileOpenChange={props.onProfileOpenChange}
          onOpenAccountSettings={props.onOpenAccountSettings}
          onSettingsClick={props.onSettingsClick}
        />
      </nav>
      <NavigatorEdgeMarkers navigatorRef={navigatorRef} position={props.position ?? "left"} />
    </TooltipSideProvider>
  );
}
