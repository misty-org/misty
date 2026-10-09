import type { DockPosition } from "@/features/app-shell/dockingLayout";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { cn, OverlaySideProvider, inwardSide } from "@/shared/ui";
import {
  NavigatorHeaderHomeButton,
  NavigatorHeaderAgentsButton,
  NavigatorHeaderSearchButton,
  NavigatorExtensionsLink,
} from "./NavigatorUtilityIsland";
import { NavigatorProfileBar } from "./NavigatorProfileBar";
import { WorkspaceSpaceNavigation } from "@/features/spaces";
import mistyLogo from "@/assets/branding/misty-white.png";
import { useRef } from "react";
import { NavigatorDestinations } from "./NavigatorDestinations";
import { NavigatorEdgeMarkers } from "./NavigatorEdgeMarkers";
import { navigatorHeaderRowClass, navigatorHierarchyActionClass } from "./styles";

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
}) {
  const navigatorRef = useRef<HTMLElement>(null);
  const focusedTab = useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((p) => p.id === state.layout.focusedPaneId) ?? panes[0];
    return pane?.views.find((tab) => tab.id === pane.activeViewId);
  });
  // Standalone pages such as Activity cover the workspace, so no app is current.
  const activeTab = props.suppressActiveTool ? undefined : focusedTab;
  return (
    <OverlaySideProvider value={inwardSide[props.position ?? "left"]}>
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
        <div
          className="shrink-0 px-3 pb-1 pt-0.5"
          data-navigator-header="true"
          data-misty-window-drag-block="true"
        >
          <div className={navigatorHeaderRowClass} data-navigator-server-row="true">
            <span
              className="misty-navigator-icon-target misty-navigator-logo grid size-8 shrink-0 place-items-center"
              role="img"
              aria-label="Misty"
            >
              <img
                src={mistyLogo}
                alt=""
                aria-hidden="true"
                className="block size-[var(--misty-navigation-icon-size)] shrink-0 object-contain"
              />
            </span>
          </div>
        </div>
        <div aria-hidden="true" className="misty-navigator-divider" />

        <div
          className="misty-navigator-body flex min-h-0 flex-1 flex-col overflow-hidden"
          data-misty-window-drag-block="true"
        >
          {/* No visible scrollbar: a classic one appearing as the Space stack
              grows would narrow the rail and shift every centered icon. */}
          <NavigatorDestinations
            position={props.position ?? "left"}
            items={[
              {
                value: "browser",
                label: "Browser",
                content: (
                  <NavigatorHeaderHomeButton
                    path="/browser"
                    active={activeTab?.surfaceId === "browser"}
                  />
                ),
              },
              {
                value: "agents",
                label: "Agents",
                content: (
                  <NavigatorHeaderAgentsButton
                    path="/agents"
                    active={
                      activeTab?.surfaceId === "agents" || activeTab?.surfaceId === "scheduled"
                    }
                  />
                ),
              },
              {
                value: "extensions",
                label: "Extensions",
                content: <NavigatorExtensionsLink active={activeTab?.surfaceId === "extensions"} />,
              },
              {
                value: "spaces",
                label: "Spaces",
                content: <WorkspaceSpaceNavigation activeTab={activeTab} />,
              },
            ]}
          />
        </div>
        <NavigatorProfileBar
          utilityControls={
            <>
              <NavigatorHeaderSearchButton className={navigatorHierarchyActionClass} />
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
    </OverlaySideProvider>
  );
}
