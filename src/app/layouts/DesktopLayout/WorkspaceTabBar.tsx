import { Blocks, Plus } from "lucide-react";
import {
  activeLayoutView,
  isEmptyTab,
  layoutTabs,
  tabLabel,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/app-windows";
import { IconButton, TabStrip, windowToolbarClass, type TabStripTab } from "@misty/ui";
import { LayoutButton } from "./LayoutButton";
import { openNewTab } from "./space_navigation";
import { ViewIcon } from "./WorkspaceViewGroupButton";
import { windowsCaptionSlotId } from "./WindowsTitlebarControls";

export function WorkspaceTabBar(props: {
  gridColumn: number;
  captionSlot?: boolean;
  onOpen(view: WorkspaceView): void;
  onClosed(): void;
}) {
  const layout = useWorkspaceStore((state) => state.layout);
  const tabs = layoutTabs(layout).filter((tab) => !isEmptyTab(tab));
  const items: TabStripTab[] = tabs.map((tab) => {
    const view = activeLayoutView(tab);
    const label = tabLabel(tab);
    return {
      id: tab.id,
      label,
      icon: <ViewIcon tab={view?.placeholder ? undefined : (view ?? undefined)} icon={Blocks} />,
      closeLabel: `Close ${label}`,
    };
  });
  const store = useWorkspaceStore.getState;
  const select = (id: string) => {
    const view = store().selectTab(id);
    if (view) props.onOpen(view);
  };

  return (
    <div
      className={`min-w-0 ${windowToolbarClass}`}
      style={{ gridColumn: props.gridColumn, gridRow: 2 }}
      data-window-toolbar
      data-misty-window-titlebar-region="true"
    >
      <TabStrip
        label="Open pages"
        tabs={items}
        active={layout.activeTabId ?? null}
        onSelect={select}
        dragCarries={(id) => {
          const tab = tabs.find((candidate) => candidate.id === id);
          const view = tab && activeLayoutView(tab);
          return view ? { "workspace-tabs": view.id } : undefined;
        }}
        onDragDwell={select}
        onClose={(id) => {
          if (store().closeTab(id)) props.onClosed();
        }}
        onReorder={(id, index) => {
          const ids = layoutTabs(store().layout).map((tab) => tab.id);
          const rest = ids.filter((other) => other !== id);
          const target = items.filter((item) => item.id !== id)[index]?.id;
          const at = target ? rest.indexOf(target) : rest.length;
          store().reorderTabs([...rest.slice(0, at), id, ...rest.slice(at)]);
        }}
        after={
          <IconButton label="New tab" onClick={() => openNewTab(props.onOpen)}>
            <Plus />
          </IconButton>
        }
        end={
          props.captionSlot ? (
            <div className="flex items-center">
              <LayoutButton />
              <div id={windowsCaptionSlotId} className="flex items-center" />
            </div>
          ) : (
            <LayoutButton />
          )
        }
        windowEdge
      />
    </div>
  );
}
