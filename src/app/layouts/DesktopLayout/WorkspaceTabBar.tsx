import { Blocks, Plus } from "lucide-react";
import {
  activeLayoutView,
  isEmptyTab,
  layoutTabs,
  tabLabel,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/app-windows";
import { IconButton, TabStrip, type TabStripTab } from "@/shared/ui";
import { LayoutButton } from "./LayoutButton";
import { openNewTab } from "./spaceNavigation";
import { ViewIcon } from "./WorkspaceViewGroupButton";

/**
 * The window's open pages as a row of tabs above the page. A tab selects its page, closes from its
 * closer or a middle click, and drags to a new place in the row. Each tab keeps its own split
 * layout, which the layout button at the row's far end edits.
 */
export function WorkspaceTabBar(props: {
  gridColumn: number;
  onOpen(view: WorkspaceView): void;
  onClosed(): void;
}) {
  const layout = useWorkspaceStore((state) => state.layout);
  // A window with no pages keeps one empty tab that is never shown.
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

  return (
    <div
      className="min-w-0"
      style={{ gridColumn: props.gridColumn, gridRow: 2 }}
      data-misty-window-titlebar-region="true"
    >
      <TabStrip
        label="Open pages"
        tabs={items}
        active={layout.activeTabId ?? null}
        onSelect={(id) => {
          const view = store().selectTab(id);
          if (view) props.onOpen(view);
        }}
        onClose={(id) => {
          if (store().closeTab(id)) props.onClosed();
        }}
        onReorder={(id, index) => {
          const ids = layoutTabs(store().layout).map((tab) => tab.id);
          const rest = ids.filter((other) => other !== id);
          // The row hides the empty tab, so place by the shown tab now at `index`.
          const target = items.filter((item) => item.id !== id)[index]?.id;
          const at = target ? rest.indexOf(target) : rest.length;
          store().reorderTabs([...rest.slice(0, at), id, ...rest.slice(at)]);
        }}
        after={
          <IconButton label="New tab" onClick={() => openNewTab(props.onOpen)}>
            <Plus />
          </IconButton>
        }
        end={<LayoutButton />}
        windowEdge
      />
    </div>
  );
}
