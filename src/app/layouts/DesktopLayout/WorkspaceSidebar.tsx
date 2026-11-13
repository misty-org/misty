import type { ReactNode } from "react";
import type { TabSide } from "@/app/shell/dockingLayout";
import type { WorkspaceView } from "@/features/app-windows";
import { cn, inwardSide, OverlaySideProvider, Surface } from "@/shared/ui";
import { SidebarNav } from "./SidebarNav";
import { SidebarToggleButton } from "./SidebarToggleButton";
import { SpaceNavigator } from "./SpaceNavigator";
import { windowsCaptionSlotId } from "./WindowsTitlebarControls";

/**
 * The window's sidebar: a new chat, search and the places, then the person's chats, each in its
 * own Space, with the account at the foot. Switching Spaces happens on the Space page. The layout button sits at the end of the tab row above
 * the page; there is no agents side panel, since the chats are right here. It lists no tabs (they are the row above
 * the page) and has no address field; web pages belong to agents, and every row opens in the
 * focused pane.
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
      {/* `misty-workspace-tabs` and `misty-sidebar-head` are markers: useMergedTitlebar gives the
          sidebar the window buttons' room (--window-chrome-left), and the macOS traffic lights
          are centred on the head's toggle (useDesktopPlatformSetup). */}
      <header
        data-tab-position={position}
        className={cn(
          "misty-workspace-tabs flex min-h-0 w-full min-w-0 shrink-0 flex-col items-stretch",
          position === "right" && "order-2",
        )}
      >
        {/* Its rows follow the card's own width, so a narrow sidebar sheds what doesn't fit. The
            card keeps 12px from the window's sides. At the bottom it keeps the window bar's inset
            (the 2px window edge plus 8px), so the account row sits level with the bar's controls,
            as the top rows sit level with the tabs. */}
        <Surface
          tone="sidebar"
          className="@container/misty-sidebar flex min-h-0 flex-1 flex-col px-3 pb-2.5"
        >
          {/* The toggle and back/forward share the window buttons' band, the shared 48px header
              row: the row starts where the native buttons end. */}
          <div
            className={cn(
              "misty-sidebar-head flex h-(--ui-header) min-h-(--ui-header) shrink-0 items-center gap-0.5",
              "pl-[max(0px,calc(var(--window-chrome-left,0px)_-_var(--pane-frame,6px)_-_12px))]",
            )}
            data-misty-window-titlebar-region="true"
          >
            {props.windowsTitlebarControls ? (
              <div id={windowsCaptionSlotId} className="flex shrink-0 items-center" />
            ) : null}
            <SidebarToggleButton side={position} />
            {/* Back and forward close the row on its right edge, pulled out by their buttons' own
                inset so the forward arrow lines up with the drawer's edge, 4px apart. */}
            <div
              className={cn(
                "-mr-1 ml-auto flex items-center",
                "[&_[data-browser-toolbar]]:gap-1 [&_[data-browser-toolbar]>div]:gap-1",
              )}
            >
              <SidebarNav />
            </div>
          </div>
          <SpaceNavigator onOpen={props.onOpen} />
          {/* The sidebar's bottom edge, above the account row. */}
          <div className="flex shrink-0 pt-1" data-misty-window-drag-block="true" />
          {props.account}
        </Surface>
      </header>
    </OverlaySideProvider>
  );
}
