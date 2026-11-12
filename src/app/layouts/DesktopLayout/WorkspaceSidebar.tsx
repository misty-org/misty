import type { ReactNode } from "react";
import type { TabSide } from "@/app/shell/dockingLayout";
import type { WorkspaceView } from "@/features/app-windows";
import { OverlaySideProvider, inwardSide } from "@/shared/ui";
import { SidebarNav } from "./SidebarNav";
import { SidebarToggleButton } from "./SidebarToggleButton";
import { LayoutButton } from "./LayoutButton";
import { SpaceNavigator } from "./SpaceNavigator";
import { windowsCaptionSlotId } from "./WindowsTitlebarControls";

/**
 * The window's sidebar: a new chat, search and the places, then the person's chats, each in its
 * own Space, with the account at the foot. Switching Spaces happens on the Space page. The layout button sits in the head beside back and
 * forward; there is no agents side panel, since the chats are right here. It lists no tabs and has no address
 * field; web pages belong to agents, and every row opens in the focused pane.
 */
export function WorkspaceSidebar(props: {
  position?: TabSide;
  windowsTitlebarControls?: boolean;
  onOpen(view: WorkspaceView): void;
  account?: ReactNode;
}) {
  const position = props.position ?? "left";
  return (
    <OverlaySideProvider value={inwardSide[position]}>
      <header
        data-tab-position={position}
        className="misty-workspace-tabs flex min-w-0 shrink-0 border-charcoal-border bg-[var(--misty-window-chrome,var(--color-charcoal-workspace))]"
      >
        <div className="misty-sidebar-card">
          <div className="misty-sidebar-head" data-misty-window-titlebar-region="true">
            {props.windowsTitlebarControls ? (
              <div id={windowsCaptionSlotId} className="flex shrink-0 items-center" />
            ) : null}
            <SidebarToggleButton side={position} />
            <LayoutButton />
            <div className="misty-sidebar-nav flex items-center">
              <SidebarNav />
            </div>
          </div>
          <SpaceNavigator onOpen={props.onOpen} />
          <div className="misty-sidebar-foot" data-misty-window-drag-block="true" />
          {props.account}
        </div>
      </header>
    </OverlaySideProvider>
  );
}
