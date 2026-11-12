import { X } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
  /** Controls after the tabs that never scroll away, such as a New tab button. */
  end?: ReactNode;
}

const tabClass = cn(
  "group/tab relative flex h-8 min-w-24 max-w-48 flex-none items-center rounded-md",
  "hover:bg-control-hover data-[selected]:bg-control-active data-[dragging]:opacity-50",
);

// The closer shows on hover, while the tab holds focus, and always on the open tab.
const closerClass = cn(
  "mr-1 opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100",
  "group-data-[selected]/tab:opacity-100",
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
 * click or the closer to close, dragging to reorder, and the tab's menu on a right-click. The row
 * scrolls sideways when the tabs don't fit, never wrapping. `end` holds controls after the tabs.
 *
 * ```tsx
 * <TabStrip label="Terminals" tabs={tabs} active={activeId} onSelect={select} onClose={close}
 *   end={<IconButton label="New terminal" onClick={add}><Plus /></IconButton>} />
 * ```
 */
export function TabStrip(props: TabStripProps) {
  const list = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);

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
    <div className="flex h-10 flex-none items-center gap-1 border-b px-2">
      <div
        ref={list}
        role="tablist"
        aria-label={props.label}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {props.tabs.map((tab, index) => {
          const selected = tab.id === props.active;
          const closable = Boolean(tab.closeLabel && props.onClose);
          const body = (
            <div
              data-selected={selected || undefined}
              data-dragging={dragging === tab.id || undefined}
              className={tabClass}
              draggable={Boolean(props.onReorder)}
              onDragStart={(event) => {
                setDragging(tab.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => {
                if (dragging && dragging !== tab.id) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging) props.onReorder?.(dragging, index);
                setDragging(null);
              }}
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
                  className={closerClass}
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
      </div>
      {props.end ? <div className="flex flex-none items-center gap-1">{props.end}</div> : null}
    </div>
  );
}
