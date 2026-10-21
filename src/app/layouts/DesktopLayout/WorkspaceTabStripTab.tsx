import { groupStyle, TabGroupTabMenu } from "./MistyTabGroups";
import { Renameable } from "@/features/navigation-names/Renameable";
import { activeLayoutView, tabLabel } from "@/features/workspace/layoutTabs";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import type { WorkspaceTab, WorkspaceView } from "@/features/workspace/model";
import type { MistyTabGroup } from "@/features/workspace/tabGroups";
import { cn, IconButton, OverflowFadeText, Pressable, TreeBranch } from "@/shared/ui";
import { Blocks, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { RefObject } from "react";
import { BrowserViewAudioButton } from "@/features/browser/workspace";
import type { useTabHoverCards } from "./TabHoverCard";
import { TabPageMenu } from "./PinnedTabMenu";
import { ViewIcon } from "./WorkspaceViewGroupButton";

/** One renameable tab in the strip. Its title follows the focused pane; × closes the whole tab. */
export function WorkspaceTabStripTab({
  tab,
  group,
  firstInGroup = false,
  lastInGroup = false,
  active,
  tabs,
  stripRef,
  pendingGroupEditor,
  hoverCards,
  onSelect,
  onEditGroupLater,
  onEditGroup,
  onOpen,
  onCloseLayoutTab,
}: {
  tab: WorkspaceTab;
  group: MistyTabGroup | undefined;
  /** The group's first and last tabs, where its vertical branch starts and ends. */
  firstInGroup?: boolean;
  lastInGroup?: boolean;
  active: boolean;
  /** Visible (not collapsed) tabs, in order, for arrow-key navigation. */
  tabs: WorkspaceTab[];
  stripRef: RefObject<HTMLDivElement | null>;
  pendingGroupEditor: RefObject<string | null>;
  hoverCards: ReturnType<typeof useTabHoverCards>;
  onSelect(id: string): void;
  /** Remember the group to edit once the tab's menu has closed. */
  onEditGroupLater(id: string): void;
  onEditGroup(id: string): void;
  onOpen(view: WorkspaceView): void;
  onCloseLayoutTab(id: string): void;
}) {
  const view = activeLayoutView(tab),
    label = tabLabel(tab),
    panes = dockLeaves(tab.root),
    pinned = Boolean(tab.pinnedUrl),
    // Any split tab's panes can be stepped through.
    rotatable = panes.length > 1;
  return (
    <Renameable
      menuItems={
        <>
          <TabPageMenu tab={tab} />
          {!pinned && <TabGroupTabMenu tab={tab} onEdit={onEditGroupLater} onOpen={onOpen} />}
        </>
      }
      onMenuCloseAutoFocus={(event) => {
        if (!pendingGroupEditor.current) return;
        event.preventDefault();
        onEditGroup(pendingGroupEditor.current);
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
        data-active={active}
        {...hoverCards.bind(view, label, active)}
        data-reorder-item={tab.id}
        data-reorder-preview="true"
        data-misty-window-drag-block="true"
        data-pinned={pinned || undefined}
        className={cn(
          group && "misty-tab-group-member",
          rotatable && "misty-tab-has-chips",
          "misty-workspace-tab group/tab flex items-center rounded-md border text-xs transition-colors",
          "duration-150 select-none focus-within:ring-1",
          "focus-within:ring-cream-muted/50",
          active
            ? "border-charcoal-border/70 bg-charcoal-card text-cream-bright shadow-sm"
            : "border-transparent text-cream-muted hover:bg-charcoal-card/40 hover:text-cream",
        )}
      >
        {group ? (
          <TreeBranch
            className="-left-3.5 w-3.5"
            color="var(--tab-group-color)"
            last={lastInGroup}
            reach={firstInGroup ? 3 : undefined}
            edge={1}
          />
        ) : null}
        <Pressable
          role="tab"
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          title={label}
          data-reorder-handle="true"
          className="flex h-full min-w-0 flex-1 items-center justify-start gap-1.5 overflow-hidden pl-2 pr-2"
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            const index = tabs.findIndex((item) => item.id === tab.id);
            const next =
              event.key === "ArrowDown"
                ? (index + 1) % tabs.length
                : event.key === "ArrowUp"
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : -1;
            if (event.altKey || event.ctrlKey || event.metaKey || next < 0) return;
            event.preventDefault();
            onSelect(tabs[next].id);
            requestAnimationFrame(() => {
              const buttons = stripRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
              buttons?.item(next)?.focus();
            });
          }}
        >
          <ViewIcon
            tab={view?.placeholder ? undefined : (view ?? undefined)}
            icon={Blocks}
            isActive={active}
          />
          {/* Room for the speaker, so the favicon, speaker and title are spaced evenly. */}
          <span aria-hidden="true" className="misty-tab-audio-gap" />
          <OverflowFadeText className="misty-workspace-tab-title min-w-0 flex-1 overflow-hidden whitespace-nowrap">
            {label}
          </OverflowFadeText>
        </Pressable>
        {rotatable ? (
          <PaneRotateChips
            tabId={tab.id}
            active={active}
            panes={panes}
            focusedPaneId={tab.focusedPaneId}
            onOpen={onOpen}
          />
        ) : null}
        {/* Drawn over the row, just after the favicon, with room made for it beside the title. */}
        <span className="misty-tab-audio-slot">
          <BrowserViewAudioButton tabs={panes.flatMap((pane) => pane.views)} />
        </span>
        {pinned ? null : (
          <IconButton
            size="xs"
            tooltip={false}
            label={`Close tab ${label}`}
            title={
              panes.length > 1
                ? `Close this pane of ${label}; the next pane takes over`
                : `Close tab ${label}`
            }
            className="misty-workspace-tab-close mr-1"
            onClick={() => onCloseLayoutTab(tab.id)}
          >
            <X className="size-3.5" size={14} />
          </IconButton>
        )}
      </div>
    </Renameable>
  );
}

/**
 * Previous and next pane, with where you are among them, as a small chip beside the tab's close
 * button, never over it. Every split tab always shows it, never a bare count, and stepping through
 * a tab you are not on opens it.
 */
function PaneRotateChips({
  tabId,
  active,
  panes,
  focusedPaneId,
  onOpen,
}: {
  tabId: string;
  active: boolean;
  panes: ReturnType<typeof dockLeaves>;
  focusedPaneId: string;
  onOpen(view: WorkspaceView): void;
}) {
  const index = Math.max(
    0,
    panes.findIndex((pane) => pane.id === focusedPaneId),
  );
  const step = (delta: number) => {
    const pane = panes[(index + delta + panes.length) % panes.length];
    if (!pane) return;
    // Stepping through another tab's panes opens that tab first.
    if (!active) useWorkspaceStore.getState().selectTab(tabId);
    useWorkspaceStore.getState().focusPane(pane.id);
    const view = pane.views.find((item) => item.id === pane.activeViewId) ?? pane.views[0];
    if (view) onOpen(view);
  };
  return (
    <span
      role="group"
      aria-label="Panes"
      data-reorder-ignore="true"
      className="misty-tab-pane-chips"
    >
      <IconButton size="2xs" tooltip={false} label="Previous pane" onClick={() => step(-1)}>
        <ChevronLeft className="size-3" aria-hidden="true" />
      </IconButton>
      <span aria-live="polite" className="text-[10px] tabular-nums">
        {index + 1}/{panes.length}
      </span>
      <IconButton size="2xs" tooltip={false} label="Next pane" onClick={() => step(1)}>
        <ChevronRight className="size-3" aria-hidden="true" />
      </IconButton>
    </span>
  );
}
