import { dockPaneCloseDirection } from "@/features/workspace/dockTree";
import { OverflowFadeText } from "@/shared/ui/overflow-fade-text";
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
import { useEffect, useRef, useState } from "react";
import { Renameable } from "@/features/navigation-names/Renameable";
import { usePointerReorder, reorderIds } from "@/shared/hooks/usePointerReorder";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  cn,
} from "@/shared/ui";
import {
  activeLayoutView,
  layoutTabs,
  layoutTabLabel,
  paneViewLabel,
} from "@/features/workspace/layoutTabs";
import { canFitDockSplit, dockLeaves, useWorkspaceStore } from "@/features/workspace";
import type { WorkspaceDockTreeProps } from "./WorkspaceDockTree";
import { minimumForWorkspaceTabs } from "./WorkspaceDockTree";
import { TabIcon } from "./WorkspaceTabGroupButton";
import { WorkspaceWindowMenu } from "./WorkspaceWindowMenu";
import {
  dockActionClass,
  WindowsWorkspaceTitlebarControls,
} from "./WindowsWorkspaceTitlebarControls";

export function WorkspaceLayoutTabs(
  props: Omit<WorkspaceDockTreeProps, "node"> & {
    onNewTab(): void;
    onCloseLayoutTab(id: string): void;
  },
) {
  const layout = useWorkspaceStore((state) => state.layout);
  const tabs = layoutTabs(layout);
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const pane =
    dockLeaves(layout.root).find((pane) => pane.id === layout.focusedPaneId) ??
    dockLeaves(layout.root)[0];
  useEffect(() => {
    const element = document.querySelector<HTMLElement>(
      `[data-workspace-pane="${CSS.escape(pane.id)}"]`,
    );
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
    canFitDockSplit(bounds, "right", minimumForWorkspaceTabs(pane.tabs), {
      width: 280,
      height: 180,
    });
  const canDown =
    canSplit &&
    canFitDockSplit(bounds, "down", minimumForWorkspaceTabs(pane.tabs), {
      width: 280,
      height: 180,
    });
  const reorder = usePointerReorder({
    scope: "workspace-layout-tabs",
    axis: "x",
    getDrag: (id) => {
      const tab = tabs.find((tab) => tab.id === id);
      return tab ? { id, label: layoutTabLabel(tab) } : null;
    },
    onDrop: (drag, target, after) =>
      useWorkspaceStore.getState().reorderLayoutTabs(
        reorderIds(
          tabs.map((tab) => tab.id),
          [drag.id],
          target,
          after,
        ),
      ),
    onKeyboardMove: (id, direction) => {
      const index = tabs.findIndex((tab) => tab.id === id),
        target = tabs[index + direction];
      if (target)
        useWorkspaceStore.getState().reorderLayoutTabs(
          reorderIds(
            tabs.map((tab) => tab.id),
            [id],
            target.id,
            direction > 0,
          ),
        );
    },
  });
  const select = (id: string) => {
    const view = useWorkspaceStore.getState().selectLayoutTab(id);
    if (view) props.onOpen(view);
  };
  return (
    <header
      ref={ref}
      className="flex h-[38px] shrink-0 items-center border-b border-charcoal-border bg-charcoal-workspace px-2"
      style={{
        paddingLeft: 8 + (props.titlebarInsets?.left ?? 0),
        paddingRight: 8 + (props.titlebarInsets?.right ?? 0),
      }}
      data-misty-window-titlebar-region={props.titlebarInsets ? "true" : undefined}
    >
      <div
        {...reorder}
        role="tablist"
        aria-label="Window tabs"
        data-tour-target="workspace-tab-bar"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
      >
        {tabs.map((tab) => {
          const active = tab.id === layout.activeLayoutTabId,
            view = activeLayoutView(tab),
            label = layoutTabLabel(tab),
            panes = dockLeaves(tab.root);
          return (
            <Renameable
              key={tab.id}
              nameKey={`layout-tab:${tab.id}`}
              automatic={layoutTabLabel({ ...tab, title: undefined })}
              customName={tab.title}
              onRename={(name) => useWorkspaceStore.getState().renameLayoutTab(tab.id, name ?? "")}
              resetLabel="Use active pane title"
            >
              <div
                data-reorder-item={tab.id}
                data-reorder-preview="true"
                data-misty-window-drag-block="true"
                className={cn(
                  "group/tab flex h-7 min-w-[80px] max-w-[160px] flex-[1_1_120px] items-center rounded-md border text-xs transition-colors duration-150 select-none focus-within:ring-1 focus-within:ring-cream-muted/50",
                  active
                    ? "border-charcoal-border/70 bg-charcoal-card text-cream-bright shadow-sm"
                    : "border-transparent text-cream-muted hover:bg-charcoal-card/40 hover:text-cream",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  title={label}
                  data-reorder-handle="true"
                  className="flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden pl-2 pr-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cream-muted"
                  onClick={() => select(tab.id)}
                  onKeyDown={(event) => {
                    const index = tabs.findIndex((item) => item.id === tab.id);
                    const next =
                      event.key === "ArrowRight"
                        ? (index + 1) % tabs.length
                        : event.key === "ArrowLeft"
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
                  <TabIcon
                    tab={view?.placeholder ? undefined : (view ?? undefined)}
                    icon={Blocks}
                    isActive={active}
                  />
                  <OverflowFadeText className="min-w-0 overflow-hidden whitespace-nowrap">
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
                </button>
                {panes.length > 1 ? (
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Show panes in ${label}`}
                        aria-description={`${panes.length} panes`}
                        className="flex h-6 shrink-0 items-center gap-0.5 rounded px-1 text-cream-muted hover:bg-charcoal-active hover:text-cream focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cream-muted"
                      >
                        <ChevronDown size={12} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[220px]">
                      {panes.map((item) => {
                        const itemView = item.tabs[0];
                        if (!itemView) return null;
                        const focused = item.id === tab.focusedPaneId;
                        return (
                          <div key={item.id} className="flex items-center gap-1">
                            <DropdownMenuItem
                              className="min-w-0 flex-1"
                              aria-label={`${paneViewLabel(itemView)}${focused ? ", active pane" : ""}`}
                              onSelect={() => {
                                useWorkspaceStore.getState().focusTab(itemView.id);
                                props.onOpen(itemView);
                              }}
                            >
                              <TabIcon
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
                              className="shrink-0 justify-center px-2"
                              onSelect={() => {
                                if (!useWorkspaceStore.getState().closeTab(itemView.id)) return;
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
                  <button
                    type="button"
                    aria-label={`Close tab ${label}`}
                    title={`Close tab ${label}`}
                    className="mr-0.5 grid size-5 shrink-0 place-items-center rounded text-cream-muted hover:bg-charcoal-active hover:text-cream focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cream-muted"
                    onClick={() => props.onCloseLayoutTab(tab.id)}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </Renameable>
          );
        })}
        <button
          type="button"
          className={dockActionClass}
          aria-label="New tab"
          title="New tab"
          onClick={props.onNewTab}
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="ml-1.5 flex h-7 shrink-0 items-center gap-1">
        {!props.windowsTitlebarControls ? (
          <>
            <button
              type="button"
              disabled={!canRight}
              className={dockActionClass}
              aria-label="Create split right"
              title="Split right"
              onClick={() => props.onSplitPane(pane.id, "right")}
            >
              <PanelRightDashed size={18} />
            </button>
            <button
              type="button"
              disabled={!canDown}
              className={dockActionClass}
              aria-label="Create split down"
              title="Split down"
              onClick={() => props.onSplitPane(pane.id, "down")}
            >
              <PanelBottomDashed size={18} />
            </button>
          </>
        ) : null}
        <WorkspaceWindowMenu
          titlebar
          windows={props.virtualWindows}
          activeWindowId={props.activeVirtualWindowId}
          canReopen={props.canReopenVirtualWindow}
          onSelect={props.onSelectVirtualWindow}
          onCreate={props.onCreateVirtualWindow}
          onClose={props.onCloseVirtualWindow}
          onReopen={props.onReopenVirtualWindow}
        />
        <button
          type="button"
          disabled={dockLeaves(layout.root).length <= 1}
          className={dockActionClass}
          aria-label="Close pane"
          title="Close pane"
          onClick={() => props.onClosePane(pane.id)}
        >
          <ClosePaneIcon size={18} />
        </button>
      </div>
      <WindowsWorkspaceTitlebarControls
        enabled={Boolean(props.windowsTitlebarControls)}
        focused
        paneId={pane.id}
        canSplitSideways={canRight}
        canSplitVertically={canDown}
        windows={props.virtualWindows}
        activeWindowId={props.activeVirtualWindowId}
        canReopen={props.canReopenVirtualWindow}
        canCloseWindow={() => props.virtualWindows.length > 1}
        onSplitPane={props.onSplitPane}
        onSelectWindow={props.onSelectVirtualWindow}
        onCreateWindow={props.onCreateVirtualWindow}
        onCloseWindow={props.onCloseVirtualWindow}
        onReopenWindow={props.onReopenVirtualWindow}
      />
    </header>
  );
}
