import { X } from "lucide-react";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { reorderIds, usePointerReorder } from "../../hooks/usePointerReorder";
import { cn } from "../classNames";
import { IconButton } from "../controls/IconButton";
import { Pressable } from "../controls/Pressable";
import { Text } from "../display/Text";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../overlays/ContextMenu";

export interface TabStripTab {
  id: string;
  label: string;
  /** A 16px mark before the label: a file's icon, a site's, a spinner while it loads. */
  icon?: ReactNode;
  /** The whole name, shown in a tooltip when the label is cut. Defaults to the label. */
  full?: string;
  /** The closer's name and tooltip, e.g. "Close notes.md". Without it the tab can't be closed. */
  closeLabel?: string;
  /** The tab's actions as menu rows, on a right-click. */
  menu?: ReactNode;
}

export interface TabStripProps {
  /** The tab list's accessible name, e.g. "Open files". */
  label: string;
  tabs: ReadonlyArray<TabStripTab>;
  active: string | null;
  onSelect(id: string): void;
  /** Closes a tab, from its closer or a middle click. Only tabs with a `closeLabel` close. */
  onClose?(id: string): void;
  /** Moves a dragged tab to `index`; without it tabs don't drag. */
  onReorder?(id: string, index: number): void;
  /** A control right after the last tab that scrolls with them, such as a New tab button. */
  after?: ReactNode;
  /** Controls at the row's far end that never scroll away. */
  end?: ReactNode;
  /**
   * The window's own tab row ends 12px in, like the sidebar's rows at the window's other side, so
   * the window has one margin on both edges. A page's tab row keeps the page header's 16px.
   */
  windowEdge?: boolean;
}

// Tabs are a sidebar row's height, padding, type and washes. The row is the shared 48px header band, so they
// have 8px above and below; the first tab's icon lines up with a page header's title, 16px in,
// and the end controls keep the page header's 16px from the edge.
const tabClass = cn(
  "group/tab relative flex h-8 min-w-32 max-w-60 flex-none items-center rounded-md",
  "hover:bg-row-hover data-[selected]:bg-row-active",
);

/** The tab a key moves to from `index`, or -1 for a key the strip leaves alone. */
function nextTabIndex(key: string, index: number, count: number): number {
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return -1;
}

/**
 * A row of tabs over a pane: 32px tabs with an icon and a label that fades when long, a closer
 * that shows on hover and on the open tab, arrows and Home/End to move between them, a middle
 * click or the closer to close, dragging (or Alt+Shift and an arrow) to reorder, and the tab's menu on a right-click. The row
 * scrolls sideways when the tabs don't fit, never wrapping. `after` holds a control right after
 * the last tab and `end` controls at the far end.
 *
 * ```tsx
 * <TabStrip label="Terminals" tabs={tabs} active={activeId} onSelect={select} onClose={close}
 *   end={<IconButton label="New terminal" onClick={add}><Plus /></IconButton>} />
 * ```
 */
export function TabStrip(props: TabStripProps) {
  const list = useRef<HTMLDivElement | null>(null);
  const ids = props.tabs.map((tab) => tab.id);
  const moveTo = (id: string, order: string[]) => props.onReorder?.(id, order.indexOf(id));
  const reorder = usePointerReorder({
    scope: useId(),
    axis: "x",
    animate: true,
    getDrag: (id) => {
      const tab = props.tabs.find((candidate) => candidate.id === id);
      return props.onReorder && tab ? { id, label: tab.label } : null;
    },
    onDrop: (drag, target, after) => moveTo(drag.id, reorderIds(ids, [drag.id], target, after)),
    onKeyboardMove: (id, direction) => {
      const target = ids[ids.indexOf(id) + direction];
      if (target) moveTo(id, reorderIds(ids, [id], target, direction === 1));
    },
  });

  const focusTab = (id: string) =>
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.focus(),
    );
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const next = nextTabIndex(event.key, index, props.tabs.length);
    if (event.altKey || event.ctrlKey || event.metaKey || next < 0) return;
    event.preventDefault();
    const tab = props.tabs[next]!;
    props.onSelect(tab.id);
    focusTab(tab.id);
  };

  return (
    <div
      className={cn(
        "flex h-(--ui-header) flex-none items-center gap-1 border-b pl-3",
        props.windowEdge ? "pr-3" : "pr-4",
      )}
    >
      <div
        {...reorder}
        ref={(element) => {
          list.current = element;
          reorder.ref(element);
        }}
        role="tablist"
        aria-label={props.label}
        className={cn(
          "flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none]",
          "gap-1",
        )}
      >
        {props.tabs.map((tab, index) => {
          const selected = tab.id === props.active;
          const closable = Boolean(tab.closeLabel && props.onClose);
          const body = (
            <div
              data-selected={selected || undefined}
              data-reorder-item={tab.id}
              data-reorder-handle={props.onReorder ? "" : undefined}
              data-reorder-preview=""
              className={tabClass}
              onAuxClick={(event) => {
                if (event.button === 1 && closable) props.onClose?.(tab.id);
              }}
            >
              <Pressable
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                data-tab-id={tab.id}
                className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 pr-1"
                onClick={() => props.onSelect(tab.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                {tab.icon ? (
                  <span className="flex size-4 flex-none items-center">{tab.icon}</span>
                ) : null}
                <Text
                  size="control"
                  tone={selected ? "bright" : "muted"}
                  className="min-w-0 flex-1 text-left"
                  full={tab.full ?? true}
                >
                  {tab.label}
                </Text>
              </Pressable>
              {closable ? (
                <IconButton
                  label={tab.closeLabel!}
                  size="sm"
                  // Always shown, on every tab, not only the open or hovered one.
                  className="mr-1"
                  data-reorder-ignore=""
                  onClick={() => props.onClose?.(tab.id)}
                >
                  <X />
                </IconButton>
              ) : null}
            </div>
          );
          return tab.menu ? (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
              <ContextMenuContent width="sm" aria-label={`${tab.label} actions`}>
                {tab.menu}
              </ContextMenuContent>
            </ContextMenu>
          ) : (
            <div key={tab.id} className="contents">
              {body}
            </div>
          );
        })}
        {props.after ? <div className="flex flex-none items-center">{props.after}</div> : null}
      </div>
      {props.end ? <div className="flex flex-none items-center gap-1">{props.end}</div> : null}
    </div>
  );
}
