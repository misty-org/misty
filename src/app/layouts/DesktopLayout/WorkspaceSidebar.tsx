import type { TabSide } from "@/app/shell/docking_layout";
import type { WorkspaceView } from "@/features/app-windows";
import { cn, inwardSide, OverlaySideProvider, Surface } from "@misty/ui";
import { useSidebarPlaceColor } from "./sidebar_place_color";
import { SidebarNav } from "./SidebarNav";
import { SidebarToggleButton } from "./SidebarToggleButton";
import { SpaceNavigator } from "./SpaceNavigator";

export function WorkspaceSidebar(props: { position?: TabSide; onOpen(view: WorkspaceView): void }) {
  const position = props.position ?? "left";
  const placeColor = useSidebarPlaceColor();
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
          className="@container/misty-sidebar flex min-h-0 flex-1 flex-col"
        >
          <div
            className="misty-sidebar-head flex h-(--ui-header) min-h-(--ui-header) min-w-0 shrink-0 items-center gap-0.5 overflow-hidden px-3"
            data-misty-window-titlebar-region="true"
          >
            <SidebarToggleButton side={position} />
            <div
              className={cn(
                "-mr-1 ml-auto flex items-center",
                "[&_[data-browser-toolbar]]:gap-1 [&_[data-browser-toolbar]>div]:gap-1",
              )}
            >
              <SidebarNav />
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-3 pb-2.5">
            <SpaceNavigator onOpen={props.onOpen} />
          </div>
        </Surface>
      </header>
    </OverlaySideProvider>
  );
}
