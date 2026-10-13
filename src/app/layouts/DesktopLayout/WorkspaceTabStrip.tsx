import { TabGroupEditor, TabGroupHeader } from "./MistyTabGroups";
import { isSideDock, type DockPosition } from "@/features/app-shell/dockingLayout";
import { cn, OverlaySideProvider, inwardSide, IconButton } from "@/shared/ui";
import { PanelBottomDashed, PanelRightDashed, Plus } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { isEmptyTab, layoutTabs } from "@/features/workspace/layoutTabs";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { useTabPresenceMotion } from "./useTabPresenceMotion";
import { useTabStripFade } from "./useTabStripGeometry";
import type { WorkspaceDockTreeProps } from "./WorkspaceDockTree";
import { WorkspaceWindowMenu } from "./WorkspaceWindowMenu";
import { FavoritesStrip } from "./FavoritesStrip";
import { useTabHoverCards } from "./TabHoverCard";
import { useWindowSwipe } from "./useWindowSwipe";
import { navigatorMotionClass } from "./styles";
import { WindowsWorkspaceTitlebarControls } from "./WindowsWorkspaceTitlebarControls";
import { useTabStripReorder } from "./useTabStripReorder";
import { useFocusedPaneSplit } from "./useFocusedPaneSplit";
import { WorkspaceTabStripTab } from "./WorkspaceTabStripTab";

export function WorkspaceTabStrip(
  props: Omit<WorkspaceDockTreeProps, "node"> & {
    position?: DockPosition;
    onNewTab(): void;
    onCloseLayoutTab(id: string): void;
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
  useWindowSwipe(ref, tabListRef, props.windows, props.activeWindowId, props.onSelectWindow);
  useTabStripFade(tabListRef, !vertical, tabs.length);
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
  const newTabButton = (
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
  return (
    <OverlaySideProvider value={inwardSide[position]}>
      <header
        ref={ref}
        data-tab-position={position}
        className={cn(
          "misty-workspace-tabs flex min-w-0 shrink-0 border-charcoal-border bg-charcoal-workspace",
          props.titlebarInsets?.animate && cn("transition-[padding]", navigatorMotionClass),
        )}
        style={
          vertical
            ? undefined
            : {
                // The first shoulder starts in the strip's inset, next to the traffic
                // lights, but never closer to the edge than a rounded pane corner.
                paddingLeft: `max(12px, ${props.titlebarInsets?.left ?? 8}px - var(--tab-shoulder))`,
                paddingRight: 8 + (props.titlebarInsets?.right ?? 0),
              }
        }
        data-misty-window-titlebar-region={props.titlebarInsets ? "true" : undefined}
      >
        <FavoritesStrip vertical={vertical} onOpen={props.onOpen} />
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
          {newTabButton}
        </div>
        {hoverCards.card}
        {editingGroup && (
          <TabGroupEditor
            key={editingGroup}
            id={editingGroup}
            onClose={() => setEditingGroup(null)}
            onOpen={props.onOpen}
          />
        )}
        {!props.windowsTitlebarControls && (
          <div className="misty-workspace-tab-actions">
            <IconButton
              size="xs"
              tooltip={false}
              disabled={!canRight}
              label="Create split right"
              title="Split right"
              onClick={() => props.onSplitPane(pane.id, "right")}
            >
              <PanelRightDashed className="size-4" size={16} />
            </IconButton>
            <IconButton
              size="xs"
              tooltip={false}
              disabled={!canDown}
              label="Create split down"
              title="Split down"
              onClick={() => props.onSplitPane(pane.id, "down")}
            >
              <PanelBottomDashed className="size-4" size={16} />
            </IconButton>
            {closePaneControl}
            <WorkspaceWindowMenu
              windows={props.windows}
              activeWindowId={props.activeWindowId}
              canReopen={props.canReopenWindow}
              onSelect={props.onSelectWindow}
              onCreate={props.onCreateWindow}
              onClose={props.onCloseWindow}
              onReopen={props.onReopenWindow}
            />
          </div>
        )}
        <WindowsWorkspaceTitlebarControls
          enabled={Boolean(props.windowsTitlebarControls)}
          focused
          paneId={pane.id}
          canSplitSideways={canRight}
          canSplitVertically={canDown}
          closePaneControl={closePaneControl}
          windows={props.windows}
          activeWindowId={props.activeWindowId}
          canReopen={props.canReopenWindow}
          canCloseWindow={() => props.windows.length > 1}
          onSplitPane={props.onSplitPane}
          onSelectWindow={props.onSelectWindow}
          onCreateWindow={props.onCreateWindow}
          onCloseWindow={props.onCloseWindow}
          onReopenWindow={props.onReopenWindow}
        />
      </header>
    </OverlaySideProvider>
  );
}
