import {
  groupName,
  groupStyle,
  TabGroupEditor,
  TabGroupHeader,
  TabGroupTabMenu,
} from "./MistyTabGroups";
import { isSideDock, type DockPosition } from "@/features/app-shell/dockingLayout";
import { BrowserViewAudioButton } from "@/features/browser/workspace";
import { dockPaneCloseDirection } from "@/features/workspace/dockTree";
import {
  cn,
  OverlaySideProvider,
  inwardSide,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  IconButton,
  MenuTrigger,
  OverflowFadeText,
  Pressable,
} from "@/shared/ui";
import {
  Blocks,
  Check,
  ChevronDown,
  PanelBottomDashed,
  PanelRightDashed,
  PanelTopClose,
  PanelBottomClose,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Renameable } from "@/features/navigation-names/Renameable";
import { usePointerReorder } from "@/shared/hooks/usePointerReorder";
import {
  activeLayoutView,
  isEmptyTab,
  layoutTabs,
  tabLabel,
  paneViewLabel,
} from "@/features/workspace/layoutTabs";
import { canFitDockSplit, dockLeaves, useWorkspaceStore } from "@/features/workspace";
import type { WorkspaceDockTreeProps } from "./WorkspaceDockTree";
import { minimumForWorkspaceViews } from "./WorkspaceDockTree";
import { ViewIcon } from "./WorkspaceViewGroupButton";
import { WorkspaceWindowMenu } from "./WorkspaceWindowMenu";
import { navigatorMotionClass } from "./styles";
import { WindowsWorkspaceTitlebarControls } from "./WindowsWorkspaceTitlebarControls";

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
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const list = tabListRef.current;
    if (!list || vertical) return;
    const updateFade = () => {
      list.style.setProperty("--tab-fade-start", list.scrollLeft > 1 ? "16px" : "0px");
      list.style.setProperty(
        "--tab-fade-end",
        list.scrollWidth - list.clientWidth - list.scrollLeft > 1 ? "16px" : "0px",
      );
    };
    updateFade();
    const observer = new ResizeObserver(updateFade);
    observer.observe(list);
    Array.from(list.children).forEach((child) => observer.observe(child));
    list.addEventListener("scroll", updateFade, { passive: true });
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", updateFade);
    };
  }, [vertical, tabs.length]);
  const pane =
    dockLeaves(layout.root).find((pane) => pane.id === layout.focusedPaneId) ??
    dockLeaves(layout.root)[0];
  useEffect(() => {
    const paneSelector = typeof CSS !== "undefined" && CSS?.escape ? CSS.escape(pane.id) : pane.id;
    const element = document.querySelector<HTMLElement>(`[data-workspace-pane="${paneSelector}"]`);
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setBounds({ width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [pane.id, layout.root]);
  const ClosePaneIcon = {
    up: PanelTopClose,
    down: PanelBottomClose,
    left: PanelLeftClose,
    right: PanelRightClose,
  }[dockPaneCloseDirection(layout.root, pane.id) ?? "up"];
  const canSplit = dockLeaves(layout.root).length < 4;
  const canRight =
    canSplit &&
    canFitDockSplit(bounds, "right", minimumForWorkspaceViews(pane.views), {
      width: 280,
      height: 180,
    });
  const canDown =
    canSplit &&
    canFitDockSplit(bounds, "down", minimumForWorkspaceViews(pane.views), {
      width: 280,
      height: 180,
    });
  const reorder = usePointerReorder({
    scope: "workspace-layout-tabs",
    axis: vertical ? "y" : "x",
    getDrag: (id) => {
      if (id.startsWith("group-header:")) {
        const group = groups.find((g) => `group-header:${g.id}` === id);
        return group ? { id, label: groupName(group) } : null;
      }
      const tab = allTabs.find((tab) => tab.id === id);
      return tab ? { id, label: tabLabel(tab) } : null;
    },
    onDrop: (drag, target, after) =>
      useWorkspaceStore.getState().moveTabGroupItem(drag.id, target, after),
    onKeyboardMove: (id, direction) => {
      const items = Array.from(
        tabListRef.current?.querySelectorAll<HTMLElement>("[data-reorder-item]") ?? [],
      ).map((item) => item.dataset.reorderItem!);
      const members = new Set(
        id.startsWith("group-header:")
          ? allTabs.filter((tab) => `group-header:${tab.tabGroupId}` === id).map((tab) => tab.id)
          : [],
      );
      let index = items.indexOf(id) + direction;
      while (members.has(items[index])) index += direction;
      const target = items[index];
      if (target) useWorkspaceStore.getState().moveTabGroupItem(id, target, direction > 0);
    },
  });
  const reorderRef = reorder.ref;
  const bindTabList = useCallback(
    (node: HTMLDivElement | null) => {
      tabListRef.current = node;
      reorderRef(node);
    },
    [reorderRef],
  );
  useEffect(() => {
    ref.current
      ?.querySelector('[aria-selected="true"]')
      ?.closest("[data-reorder-item]")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [layout.activeTabId, position]);
  const newTabButton = (
    <IconButton size="xs" tooltip={false} label="New tab" onClick={props.onNewTab}>
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
                paddingLeft: props.titlebarInsets?.left ?? 8,
                paddingRight: 8 + (props.titlebarInsets?.right ?? 0),
              }
        }
        data-misty-window-titlebar-region={props.titlebarInsets ? "true" : undefined}
      >
        <div
          {...reorder}
          ref={bindTabList}
          role="tablist"
          aria-label="Window tabs"
          aria-orientation={vertical ? "vertical" : "horizontal"}
          data-tour-target="workspace-tab-bar"
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
            const active = tab.id === layout.activeTabId,
              view = activeLayoutView(tab),
              label = tabLabel(tab),
              panes = dockLeaves(tab.root);
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
                  <Renameable
                    menuItems={
                      <TabGroupTabMenu
                        tab={tab}
                        onEdit={(id) => {
                          pendingGroupEditor.current = id;
                        }}
                        onOpen={props.onOpen}
                      />
                    }
                    onMenuCloseAutoFocus={(event) => {
                      if (!pendingGroupEditor.current) return;
                      event.preventDefault();
                      setEditingGroup(pendingGroupEditor.current);
                      pendingGroupEditor.current = null;
                    }}
                    nameKey={`layout-tab:${tab.id}`}
                    automatic={tabLabel({ ...tab, title: undefined })}
                    customName={tab.title}
                    onRename={(name) => useWorkspaceStore.getState().renameTab(tab.id, name ?? "")}
                    resetLabel="Use active pane title"
                  >
                    <div
                      style={group ? groupStyle(group) : undefined}
                      data-group-active={group ? active : undefined}
                      data-reorder-item={tab.id}
                      data-reorder-preview="true"
                      data-misty-window-drag-block="true"
                      className={cn(
                        group && "misty-tab-group-member",
                        "misty-workspace-tab group/tab flex items-center rounded-md border text-xs transition-colors",
                        "duration-150 select-none focus-within:ring-1",
                        "focus-within:ring-cream-muted/50",
                        active
                          ? "border-charcoal-border/70 bg-charcoal-card text-cream-bright shadow-sm"
                          : "border-transparent text-cream-muted hover:bg-charcoal-card/40 hover:text-cream",
                      )}
                    >
                      <Pressable
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        title={label}
                        data-reorder-handle="true"
                        className="flex h-full min-w-0 flex-1 items-center justify-start gap-1.5 overflow-hidden pl-2 pr-1"
                        onClick={() => select(tab.id)}
                        onKeyDown={(event) => {
                          const index = tabs.findIndex((item) => item.id === tab.id);
                          const next =
                            event.key === (vertical ? "ArrowDown" : "ArrowRight")
                              ? (index + 1) % tabs.length
                              : event.key === (vertical ? "ArrowUp" : "ArrowLeft")
                                ? (index + tabs.length - 1) % tabs.length
                                : event.key === "Home"
                                  ? 0
                                  : event.key === "End"
                                    ? tabs.length - 1
                                    : -1;
                          if (event.altKey || event.ctrlKey || event.metaKey || next < 0) return;
                          event.preventDefault();
                          select(tabs[next].id);
                          requestAnimationFrame(() => {
                            const buttons =
                              ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                            buttons?.item(next)?.focus();
                          });
                        }}
                      >
                        <ViewIcon
                          tab={view?.placeholder ? undefined : (view ?? undefined)}
                          icon={Blocks}
                          isActive={active}
                        />
                        <OverflowFadeText className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                          {label}
                        </OverflowFadeText>
                        {panes.length > 1 ? (
                          <span
                            aria-hidden="true"
                            className="shrink-0 text-[10px] text-cream-muted tabular-nums"
                          >
                            {panes.length}
                          </span>
                        ) : null}
                      </Pressable>
                      <BrowserViewAudioButton tabs={panes.flatMap((pane) => pane.views)} />
                      {panes.length > 1 ? (
                        <DropdownMenu modal={false}>
                          <MenuTrigger
                            iconOnly
                            size="xs"
                            className="mr-0.5"
                            label={`Show panes in ${label}`}
                            aria-description={`${panes.length} panes`}
                            icon={<ChevronDown className="size-3" size={12} />}
                          />
                          <DropdownMenuContent
                            align="start"
                            width="md"
                            className="max-w-[calc(100vw-24px)]"
                          >
                            {panes.map((item) => {
                              const itemView = item.views[0];
                              if (!itemView) return null;
                              const focused = item.id === tab.focusedPaneId;
                              return (
                                <div key={item.id} className="flex items-center gap-1">
                                  <DropdownMenuItem
                                    className="min-w-0 flex-1"
                                    aria-label={`${paneViewLabel(itemView)}${focused ? ", active pane" : ""}`}
                                    onSelect={() => {
                                      useWorkspaceStore.getState().focusView(itemView.id);
                                      props.onOpen(itemView);
                                    }}
                                  >
                                    <ViewIcon
                                      tab={itemView.placeholder ? undefined : itemView}
                                      icon={Blocks}
                                    />
                                    <span className="min-w-0 flex-1 truncate">
                                      {paneViewLabel(itemView)}
                                    </span>
                                    {focused ? <Check size={14} aria-hidden /> : null}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    aria-label={`Close pane ${paneViewLabel(itemView)}`}
                                    className="w-8 shrink-0 justify-center px-0"
                                    onSelect={() => {
                                      if (!useWorkspaceStore.getState().closeView(itemView.id))
                                        return;
                                      const current = activeLayoutView(
                                        useWorkspaceStore.getState().layout,
                                      );
                                      if (current) props.onOpen(current);
                                    }}
                                  >
                                    <X size={14} aria-hidden />
                                  </DropdownMenuItem>
                                </div>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <IconButton
                          size="xs"
                          tooltip={false}
                          label={`Close tab ${label}`}
                          title={`Close tab ${label}`}
                          className="mr-0.5"
                          onClick={() => props.onCloseLayoutTab(tab.id)}
                        >
                          <X className="size-3.5" size={14} />
                        </IconButton>
                      )}
                    </div>
                  </Renameable>
                )}
              </Fragment>
            );
          })}
          {newTabButton}
        </div>
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
