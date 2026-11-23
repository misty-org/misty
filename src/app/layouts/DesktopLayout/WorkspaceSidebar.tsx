import type { ReactNode } from "react";
import type { TabSide } from "@/app/shell/docking_layout";
import type { WorkspaceView } from "@/features/app-windows";
import { spaceTone, useWindowSpace } from "@/features/spaces";
import { cn, inwardSide, OverlaySideProvider, Surface } from "@misty/ui";
import { PlaceToggle } from "./PlaceToggle";
import { usePlace } from "./place_store";
import { SidebarNav } from "./SidebarNav";
import { SidebarToggleButton } from "./SidebarToggleButton";
import { SpaceNavigator } from "./SpaceNavigator";

export function WorkspaceSidebar(props: {
  position?: TabSide;
  onOpen(view: WorkspaceView): void;
  account?: ReactNode;
}) {
  const position = props.position ?? "left";
  const space = useWindowSpace();
  const place = usePlace();
  const placeColor =
    place === "spaces" && space && !space.is_default ? spaceTone(space.id) : undefined;
  return (
    <OverlaySideProvider value={inwardSide[position]}>
      <header
        data-tab-position={position}
        className={cn(
          "misty-workspace-tabs flex min-h-0 w-full min-w-0 shrink-0 flex-col items-stretch",
          position === "right" && "order-2",
        )}
      >
        <Surface
          tone="sidebar"
          place={placeColor}
          className="@container/misty-sidebar flex min-h-0 flex-1 flex-col px-3 pb-2.5"
        >
          <div
            className={cn(
              "misty-sidebar-head flex h-(--ui-header) min-h-(--ui-header) min-w-0 shrink-0 items-center gap-0.5 overflow-hidden",
              "pl-[max(0px,calc(var(--window-chrome-left,0px)_-_var(--pane-frame,var(--spacing)_*_1.5)_-_var(--spacing)_*_3))]",
            )}
            data-misty-window-titlebar-region="true"
          >
            <SidebarToggleButton side={position} />
            <div className="ml-1 flex shrink-0 items-center">
              <PlaceToggle />
            </div>
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
          <div className="flex shrink-0 pt-1" data-misty-window-drag-block="true" />
          {props.account}
        </Surface>
      </header>
    </OverlaySideProvider>
  );
}
