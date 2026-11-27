import { User, Users } from "lucide-react";
import type { TabSide } from "@/app/shell/docking_layout";
import type { WorkspaceView } from "@/features/app-windows";
import { platform } from "@/shared/platform/os";
import { cn, inwardSide, OverlaySideProvider, PlaceSwitch, Surface } from "@misty/ui";
import { useAttentionCounts, useSpaceMentionCounting } from "./attention";
import { choosePlace, usePlace, useSharedSpaces, useSpacesSideFollowsSpaces } from "./place_store";
import { SidebarNav } from "./SidebarNav";
import { SidebarToggleButton } from "./SidebarToggleButton";
import { SpaceNavigator } from "./SpaceNavigator";

function PlaceToggle() {
  const place = usePlace();
  const counts = useAttentionCounts();
  const shared = useSharedSpaces();
  useSpacesSideFollowsSpaces();
  useSpaceMentionCounting();
  const sharedWaiting = [...counts.bySpace.entries()].some(
    ([id, mark]) => mark.state === "waiting" && shared.some((space) => space.id === id),
  );
  return (
    <PlaceSwitch
      label="Personal or shared Spaces"
      value={place}
      onChange={choosePlace}
      options={[
        {
          value: "personal",
          label: "Personal",
          icon: <User aria-hidden="true" />,
          waiting: counts.personal.state === "waiting",
        },
        {
          value: "spaces",
          label: "Shared Spaces",
          icon: <Users aria-hidden="true" />,
          waiting: sharedWaiting,
        },
      ]}
    />
  );
}

export function WorkspaceSidebar(props: { position?: TabSide; onOpen(view: WorkspaceView): void }) {
  const position = props.position ?? "left";
  const clearsLights = position === "left" && platform() === "macos";
  return (
    <OverlaySideProvider value={inwardSide[position]}>
      <header
        data-tab-position={position}
        className={cn(
          "misty-workspace-tabs flex min-h-0 w-full min-w-0 shrink-0 flex-col items-stretch",
          position === "right" && "order-2",
        )}
      >
        <Surface tone="chrome" className="@container/misty-sidebar flex min-h-0 flex-1 flex-col">
          <div
            className={cn(
              "misty-sidebar-head flex h-(--ui-header) min-h-(--ui-header) min-w-0 shrink-0 items-center gap-1 overflow-hidden px-3",
              clearsLights && "pl-21",
            )}
            data-misty-window-titlebar-region="true"
          >
            <SidebarToggleButton side={position} />
            <div className="flex items-center [&_[data-browser-toolbar]]:gap-1">
              <SidebarNav />
            </div>
            <div className="ml-auto flex items-center" data-misty-window-drag-block="true">
              <PlaceToggle />
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-3 pb-2">
            <SpaceNavigator onOpen={props.onOpen} />
          </div>
        </Surface>
      </header>
    </OverlaySideProvider>
  );
}
