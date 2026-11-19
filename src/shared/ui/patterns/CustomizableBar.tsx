import { RotateCcw } from "lucide-react";
import { useId, type ReactNode } from "react";
import { reorderIds, usePointerReorder } from "@/shared/hooks/usePointerReorder";
import { cn } from "../classNames";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../overlays/ContextMenu";
import { MenuCheckItem, MenuItem, MenuSeparator } from "../overlays/MenuItem";

/** One thing a bar can show: its name in the bar's menu, and what it draws in the bar. `node`
 * null means it can't show right now (nothing to act on); it's left out of the bar and the menu. */
export interface BarItem {
  label: string;
  node: ReactNode;
}

/** A bar's arrangement: every item in order, and the ones the person hid. */
export interface BarLayout {
  order: string[];
  hidden: string[];
}

/**
 * A bar the person arranges: its items drag into a new order (or move with ⌥⇧ and the arrow
 * keys while one has focus), and a right-click anywhere on the bar lists every item with a check
 * to show or hide it, and Reset to put the bar back as it came. The caller keeps the layout (for
 * the device); a press that doesn't move is still a click on the item.
 *
 * `arrangement="dock"` lays a row out as a game's HUD does: the first item at the start, the last
 * at the end, the rest in the middle, so dragging one past another moves it to that place. A
 * hidden item (or one with nothing to show right now) keeps its place empty. A text field inside
 * keeps its own right-click menu.
 *
 * ```tsx
 * <CustomizableBar label="Panels" axis="y" items={items} layout={layout}
 *   onChange={save} onReset={reset} className="gap-1" />
 * ```
 */
export function CustomizableBar(props: {
  /** The bar's name, for its menu and assistive tech. */
  label: string;
  axis: "x" | "y";
  /** Every item by id. An id in the layout with no item here (or a null `node`) isn't shown. */
  items: Record<string, BarItem>;
  layout: BarLayout;
  onChange(layout: BarLayout): void;
  onReset(): void;
  /** `row` (the default) packs the items in order; `dock` places them at start, middle and end. */
  arrangement?: "row" | "dock";
  /** Layout only: the gap between items and the bar's padding. */
  className?: string;
  [key: `data-${string}`]: string | undefined;
}) {
  const { label, axis, items, layout, onChange, onReset, arrangement, className, ...data } = props;
  const dock = arrangement === "dock";
  // A dock keeps every item's place, even one with nothing to show right now.
  const available = layout.order.filter((id) => items[id] && (dock || items[id].node !== null));
  const shown = available.filter((id) => !layout.hidden.includes(id));
  const move = (id: string, target: string, after: boolean) =>
    onChange({ ...layout, order: reorderIds(layout.order, [id], target, after) });
  const reorder = usePointerReorder({
    scope: useId(),
    axis,
    getDrag: (id) => ({ id, label: items[id]?.label ?? id }),
    onDrop: (drag, target, after) => move(drag.id, target, after),
    // A step passes the next item the bar shows, never a hidden one.
    onKeyboardMove: (id, direction) => {
      const neighbour = shown[shown.indexOf(id) + direction];
      if (neighbour) move(id, neighbour, direction === 1);
    },
  });
  const setShown = (id: string, on: boolean) =>
    onChange({
      ...layout,
      hidden: on ? layout.hidden.filter((other) => other !== id) : [...layout.hidden, id],
    });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          {...reorder}
          {...data}
          onContextMenuCapture={(event) => {
            if ((event.target as Element).closest("input, textarea, [contenteditable=true]"))
              event.stopPropagation();
          }}
          role="toolbar"
          aria-label={label}
          aria-orientation={axis === "y" ? "vertical" : "horizontal"}
          className={cn(
            dock ? "grid grid-cols-[1fr_auto_1fr] items-end" : "flex items-center",
            !dock && axis === "y" && "flex-col",
            className,
          )}
        >
          {(dock ? available : shown).map((id, index, placed) => (
            // An item with nothing to say right now draws nothing, and takes no gap either. Down
            // a column an item takes the column's width (a sidebar row runs edge to edge).
            <div
              key={id}
              className={cn("flex empty:hidden", axis === "y" && "flex-col")}
              data-reorder-item={id}
              data-reorder-handle=""
              data-reorder-preview=""
              style={dock ? dockPlace(index, placed.length) : undefined}
            >
              {layout.hidden.includes(id) ? null : items[id].node}
            </div>
          ))}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        {available.map((id) => (
          <MenuCheckItem
            key={id}
            label={items[id].label}
            checked={!layout.hidden.includes(id)}
            onCheckedChange={(on) => setShown(id, on)}
          />
        ))}
        <MenuSeparator />
        <MenuItem icon={RotateCcw} label="Reset to default" onSelect={onReset} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A dock item's cell: the first at the start, the last at the end, the rest in the middle. */
function dockPlace(index: number, count: number) {
  const side = index === 0 ? "start" : index === count - 1 ? "end" : "center";
  return {
    gridRow: 1,
    gridColumn: side === "start" ? 1 : side === "end" ? 3 : 2,
    justifySelf: side,
  } as const;
}
