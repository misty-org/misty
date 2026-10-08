import type { ReactNode } from "react";
import { TabGroupEditor, TabGroupHeader } from "./MistyTabGroups";
import { isSideDock, type DockPosition } from "@/features/app-shell/dockingLayout";
import { cn, Pressable, OverlaySideProvider, inwardSide, IconButton } from "@/shared/ui";
import { Plus } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { isEmptyTab, layoutTabs } from "@/features/workspace/layoutTabs";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { useTabPresenceMotion } from "./useTabPresenceMotion";
import { useTabStripFade } from "./useTabStripGeometry";
import type { WorkspaceDockTreeProps } from "./WorkspaceDockTree";
import { FavoritesStrip } from "./FavoritesStrip";
import { useTabHoverCards } from "./TabHoverCard";
import { navigatorMotionClass } from "./styles";
import { WindowsWorkspaceTitlebarControls } from "./WindowsWorkspaceTitlebarControls";
import { useTabStripReorder } from "./useTabStripReorder";
import { useFocusedPaneSplit } from "./useFocusedPaneSplit";
import { SidebarToggleButton } from "@/features/app-shell/SidebarToggleButton";
import { useBrowserToolbarSlot } from "@/features/browser/workspace";
import { SidebarAddressFallback, SidebarNavFallback } from "./SidebarFallbacks";
import { SidebarNowPlaying } from "./SidebarNowPlaying";
import { WorkspaceTabStripTab } from "./WorkspaceTabStripTab";
import { dockingMetrics } from "./dockingGeometry";

const setNavSlot = (element: HTMLDivElement | null) =>
  useBrowserToolbarSlot.getState().setNav(element);
const setTopSlot = (element: HTMLDivElement | null) =>
  useBrowserToolbarSlot.getState().setTop(element);

export function WorkspaceTabStrip(
  props: Omit<WorkspaceDockTreeProps, "node"> & {
    position?: DockPosition;
    onNewTab(): void;
    onCloseLayoutTab(id: string): void;
    account?: ReactNode;
    /** The sidebar's bottom-left: downloads. */
    footEnd?: ReactNode;
  },
) {
  const position = props.position ?? "top";
  const vertical = isSideDock(position);
  const layout = useWorkspaceStore((state) => state.layout);
  // A workspace with no tabs keeps one empty layout tab that is never shown.
  const allTabs = layoutTabs(layout).filter((tab) => !isEmptyTab(tab));
  const groups = useWorkspaceStore((state) => state.tabGroups);
  const pendingGroupEditor = useRef<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const tabs = allTabs.filter(
    (tab) => !groups.find((group) => group.id === tab.tabGroupId)?.collapsed,
  );
  const shownGroups = new Set<string>();
  useEffect(() => {
    const active = allTabs.find((t) => t.id === layout.activeTabId);
    if (active?.tabGroupId && groups.find((g) => g.id === active.tabGroupId)?.collapsed)
      useWorkspaceStore.getState().selectTab(active.id);
  }, [layout.activeTabId, allTabs, groups]);
  const ref = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  useTabPresenceMotion(tabListRef, !vertical);
  const hoverCards = useTabHoverCards();
  useTabStripFade(tabListRef, true, tabs.length, vertical ? "y" : "x");
  const { pane, ClosePaneIcon, canRight, canDown } = useFocusedPaneSplit(layout);
  const { reorder, bindTabList } = useTabStripReorder({
    vertical,
    groups,
    tabs,
    allTabs,
    tabListRef,
  });
  useEffect(() => {
    ref.current
      ?.querySelector('[aria-selected="true"]')
      ?.closest("[data-reorder-item]")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [layout.activeTabId, position]);
  const newTabButton = vertical ? (
    <Pressable
      type="button"
      className="misty-workspace-new-tab misty-workspace-new-tab-row"
      onClick={props.onNewTab}
    >
      <Plus className="size-4" aria-hidden="true" />
      New Tab
    </Pressable>
  ) : (
    <IconButton
      className="misty-workspace-new-tab"
      size="xs"
      tooltip={false}
      label="New tab"
      onClick={props.onNewTab}
    >
      <Plus className="size-3.5" />
    </IconButton>
  );
  const select = (id: string) => {
    const view = useWorkspaceStore.getState().selectTab(id);
    if (view) props.onOpen(view);
  };
  const closePaneControl = (
    <IconButton
      size="xs"
      tooltip={false}
      disabled={dockLeaves(layout.root).length <= 1}
      label="Close pane"
      title="Close pane"
      onClick={() => props.onClosePane(pane.id)}
    >
      <ClosePaneIcon className="size-4" size={16} />
    </IconButton>
  );
  const cardBody = (
    <>
      {vertical && (
        <div className="misty-sidebar-address">
          <div ref={setTopSlot} className="misty-workspace-toolbar-slot" />
          <SidebarAddressFallback />
        </div>
      )}
      {vertical ? <FavoritesStrip vertical onOpen={props.onOpen} /> : null}
      <div
        {...reorder}
        ref={bindTabList}
        role="tablist"
        aria-label="Window tabs"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        className={cn(
          "misty-workspace-tab-list flex min-w-0 flex-1 gap-1",
          vertical
            ? "min-h-0 flex-col overflow-x-hidden overflow-y-auto"
            : "items-center overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {vertical && newTabButton}
        {allTabs.map((tab) => {
          const group = groups.find((g) => g.id === tab.tabGroupId);
          const firstInGroup = group && !shownGroups.has(group.id);
          if (group) shownGroups.add(group.id);
          return (
            <Fragment key={tab.id}>
              {firstInGroup && (
                <TabGroupHeader
                  group={group}
                  count={allTabs.filter((t) => t.tabGroupId === group.id).length}
                  onEdit={setEditingGroup}
                  onOpen={props.onOpen}
                />
              )}
              {!group?.collapsed && (
                <WorkspaceTabStripTab
                  tab={tab}
                  group={group}
                  active={tab.id === layout.activeTabId}
                  vertical={vertical}
                  tabs={tabs}
                  stripRef={ref}
                  pendingGroupEditor={pendingGroupEditor}
                  hoverCards={hoverCards}
                  onSelect={select}
                  onEditGroupLater={(id) => {
                    pendingGroupEditor.current = id;
                  }}
                  onEditGroup={setEditingGroup}
                  onOpen={props.onOpen}
                  onCloseLayoutTab={props.onCloseLayoutTab}
                />
              )}
            </Fragment>
          );
        })}
        {!vertical && newTabButton}
      </div>
    </>
  );
  return (
    <OverlaySideProvider value={inwardSide[position]}>
      <header
        ref={ref}
        data-tab-position={position}
        className={cn(
          "misty-workspace-tabs flex min-w-0 shrink-0 border-charcoal-border bg-[var(--misty-window-chrome,var(--color-charcoal-workspace))]",
          props.titlebarInsets?.animate && cn("transition-[padding]", navigatorMotionClass),
        )}
        style={
          vertical
            ? undefined
            : {
                // The first shoulder starts a little past the window buttons, and never closer to the
                // edge than a rounded pane corner.
                paddingLeft: `max(12px, ${(props.titlebarInsets?.left ?? 0) + dockingMetrics.tabLead}px)`,
                paddingRight: 8 + (props.titlebarInsets?.right ?? 0),
              }
        }
        data-misty-window-titlebar-region={props.titlebarInsets ? "true" : undefined}
      >
        {vertical ? (
          <div className="misty-sidebar-card">
            <div className="misty-sidebar-head" data-misty-window-titlebar-region="true">
              <SidebarToggleButton side={position === "right" ? "right" : "left"} />
              <div className="misty-sidebar-nav flex items-center">
                <div ref={setNavSlot} className="flex items-center" />
                <SidebarNavFallback />
              </div>
            </div>
            {cardBody}
            <SidebarNowPlaying />
            <div className="misty-sidebar-foot" data-misty-window-drag-block="true">
              {props.footEnd}
            </div>
          </div>
        ) : (
          cardBody
        )}
        {vertical ? props.account : null}
        {hoverCards.card}
        {editingGroup && (
          <TabGroupEditor
            key={editingGroup}
            id={editingGroup}
            onClose={() => setEditingGroup(null)}
            onOpen={props.onOpen}
          />
        )}
        <WindowsWorkspaceTitlebarControls
          enabled={Boolean(props.windowsTitlebarControls)}
          focused
          paneId={pane.id}
          canSplitSideways={canRight}
          canSplitVertically={canDown}
          closePaneControl={closePaneControl}
          onSplitPane={props.onSplitPane}
        />
      </header>
    </OverlaySideProvider>
  );
}
