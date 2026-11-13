import { MoreHorizontal } from "lucide-react";
import * as React from "react";
import { cn } from "../classNames";
import { Button } from "../controls/Button";
import { IconButton } from "../controls/IconButton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../overlays/DropdownMenu";
import { MenuCheckItem, MenuItem, MenuSubmenu } from "../overlays/MenuItem";
import { OverflowFadeText } from "./OverflowFadeText";

/**
 * An icon given to a shared component: a component such as a Lucide icon (`Folder`), or an element
 * for marks that need props (`<BrandIcon id="claude" />`). Components get the size from their slot.
 */
export type IconSource =
  | React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>
  | React.ReactElement;

/** Draws an IconSource at the slot's size. Elements are drawn as given. */
export function renderIcon(icon: IconSource | undefined, className?: string): React.ReactNode {
  if (!icon) return null;
  if (React.isValidElement(icon)) return icon;
  const Icon = icon;
  return <Icon aria-hidden="true" className={className} />;
}

export type ActionBarSize = "sm" | "md";
export type ActionBarMode = "full" | "icon";

export type ActionBarItem = {
  id: string;
  icon: IconSource;
  label: string;
  /** A key hint shown in the icon's tooltip and in the ⋯ menu, e.g. "⌘K". */
  shortcut?: string;
  onSelect?: () => void;
  /**
   * Draws the item yourself, for controls that aren't a plain button (a model picker, a send
   * button). `full` has room for its label; `icon` is the compact form, one control height wide
   * when it can be. Keep `onSelect` or `menu` set too, so the item still works once it folds.
   */
  render?: (mode: ActionBarMode) => React.ReactNode;
  /** Higher stays longest. Ties give way from the right. */
  priority: number;
  /**
   * The one long name that may shorten (a model, a branch). It keeps its label while the others
   * turn into icons, then fades down to `minWidth`, and folds last in its priority. Only the first
   * shrink item counts.
   */
  shrink?: boolean;
  /** How narrow the shrink item may get, in pixels. Default 80. */
  minWidth?: number;
  /** Rows shown as a submenu when the item has folded into ⋯, e.g. a picker's choices. */
  menu?: React.ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
  /** A toggle that is on. */
  pressed?: boolean;
};

export type ActionBarProps = {
  /** Accessible name of the toolbar, e.g. "Page actions". */
  label: string;
  size?: ActionBarSize;
  items: ReadonlyArray<ActionBarItem>;
  /** Always shown at the end and never folds, e.g. the composer's send button. */
  end?: React.ReactNode;
  /**
   * `fill` (default) takes the row and pushes `end` to its far edge. `content` is only as wide as
   * the items need, up to the parent's width, so a neighbour that fades (a page title) gives way
   * before the bar does.
   */
  width?: "fill" | "content";
  /** Layout only: margins or placement. */
  className?: string;
};

/** One control height per bar size, which is also an icon button's width. */
const controlPx: Record<ActionBarSize, number> = { sm: 24, md: 32 };
/** gap-1 between controls. */
const gapPx = 4;
const defaultMinWidth = 80;

export type ActionBarPlacement = "full" | "icon" | "folded";

export type ActionBarMeasure = {
  id: string;
  priority: number;
  shrink?: boolean;
  /** Natural width with its label. */
  full: number;
  /** Width in icon form. */
  icon: number;
  /** The shrink item's narrowest width. */
  minWidth?: number;
};

export type ActionBarPlan = {
  placements: Record<string, ActionBarPlacement>;
  /** Width to hold the shrink item to, or null when it shows in full. */
  shrinkWidth: number | null;
  /** Even with everything folded the bar is too narrow. */
  overflowing: boolean;
};

/**
 * The order items give way in: lowest priority first, and among equals the rightmost first. It
 * depends only on priorities and positions, so the bar always gives way the same way.
 */
export function actionBarGiveWayOrder(
  items: ReadonlyArray<Pick<ActionBarMeasure, "id" | "priority">>,
): string[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.priority - b.item.priority || b.index - a.index)
    .map(({ item }) => item.id);
}

/**
 * Decides what each item shows at a given width. The bar walks one fixed sequence and stops at
 * the first step that fits: (1) labels turn into icons, lowest priority first, the shrink item
 * excepted; (2) the shrink item fades down to its minimum width; (3) items fold into a trailing ⋯,
 * lowest priority first. Because it is one sequence, a narrower bar is never less folded than a
 * wider one.
 */
export function planActionBar(input: {
  available: number;
  items: ReadonlyArray<ActionBarMeasure>;
  /** Width of the ⋯ button. */
  more: number;
  /** Width of the `end` slot, or 0 when there is none. */
  end: number;
  gap?: number;
}): ActionBarPlan {
  const { available, items, more, end } = input;
  const gap = input.gap ?? gapPx;
  const placements: Record<string, ActionBarPlacement> = {};
  for (const item of items) placements[item.id] = "full";
  const shrinkItem = items.find((item) => item.shrink);
  const order = actionBarGiveWayOrder(items);

  // Width of everything except the shrink item, and how many controls sit in the row.
  const fixedWidth = () => {
    let width = 0;
    let count = 0;
    let folded = false;
    for (const item of items) {
      const placement = placements[item.id];
      if (placement === "folded") {
        folded = true;
        continue;
      }
      count += 1;
      if (item !== shrinkItem) width += placement === "full" ? item.full : item.icon;
    }
    if (folded) {
      width += more;
      count += 1;
    }
    if (end > 0) {
      width += end;
      count += 1;
    }
    return width + Math.max(0, count - 1) * gap;
  };
  const shrinkVisible = () => Boolean(shrinkItem && placements[shrinkItem.id] !== "folded");
  // The width left for the shrink item, or the whole row's fit when there is none.
  const room = () => available - fixedWidth();
  const result = (shrinkWidth: number | null, overflowing = false): ActionBarPlan => ({
    placements: { ...placements },
    shrinkWidth,
    overflowing,
  });
  const fitsInFull = () => room() >= (shrinkVisible() ? shrinkItem!.full : 0);
  const fitsShrunk = () => {
    if (!shrinkVisible()) return null;
    const left = room();
    const min = Math.min(shrinkItem!.minWidth ?? defaultMinWidth, shrinkItem!.full);
    if (left < min) return null;
    return left >= shrinkItem!.full ? null : Math.floor(left);
  };

  if (fitsInFull()) return result(null);
  for (const id of order) {
    if (id === shrinkItem?.id) continue;
    placements[id] = "icon";
    if (fitsInFull()) return result(null);
  }
  const shrunk = fitsShrunk();
  if (shrunk !== null) return result(shrunk);
  for (const id of order) {
    placements[id] = "folded";
    if (fitsInFull()) return result(null);
    const width = fitsShrunk();
    if (width !== null) return result(width);
  }
  return result(null, room() < 0);
}

function samePlan(a: ActionBarPlan, b: ActionBarPlan) {
  if (a.shrinkWidth !== b.shrinkWidth || a.overflowing !== b.overflowing) return false;
  const keys = Object.keys(a.placements);
  if (keys.length !== Object.keys(b.placements).length) return false;
  return keys.every((key) => a.placements[key] === b.placements[key]);
}

const allFull = (items: ReadonlyArray<ActionBarItem>): ActionBarPlan => ({
  placements: Object.fromEntries(items.map((item) => [item.id, "full" as const])),
  shrinkWidth: null,
  overflowing: false,
});

const widthOf = (element: Element | null | undefined) =>
  element ? element.getBoundingClientRect().width : 0;

function DefaultItem({
  item,
  mode,
  size,
  shrinking,
}: {
  item: ActionBarItem;
  mode: ActionBarMode;
  size: ActionBarSize;
  shrinking: boolean;
}) {
  const variant = item.variant ?? "quiet";
  if (mode === "icon")
    return (
      <IconButton
        label={item.label}
        shortcut={item.shortcut}
        size={size}
        variant={variant}
        disabled={item.disabled}
        aria-pressed={item.pressed}
        onClick={item.onSelect}
      >
        {renderIcon(item.icon)}
      </IconButton>
    );
  return (
    <Button
      size={size}
      variant={variant}
      icon={item.icon}
      disabled={item.disabled}
      aria-pressed={item.pressed}
      className={shrinking ? "min-w-0 max-w-full" : undefined}
      onClick={item.onSelect}
    >
      {shrinking ? <OverflowFadeText full>{item.label}</OverflowFadeText> : item.label}
    </Button>
  );
}

function ItemBody({
  item,
  mode,
  size,
  shrinking,
}: {
  item: ActionBarItem;
  mode: ActionBarMode;
  size: ActionBarSize;
  shrinking: boolean;
}) {
  if (item.render) return <>{item.render(mode)}</>;
  return <DefaultItem item={item} mode={mode} size={size} shrinking={shrinking} />;
}

function FoldedItem({ item }: { item: ActionBarItem }) {
  if (item.menu)
    return (
      <MenuSubmenu icon={item.icon} label={item.label} disabled={item.disabled}>
        {item.menu}
      </MenuSubmenu>
    );
  // A toggle keeps its state in the menu, as a checkmark.
  if (item.pressed !== undefined)
    return (
      <MenuCheckItem
        icon={item.icon}
        label={item.label}
        shortcut={item.shortcut}
        disabled={item.disabled}
        checked={item.pressed}
        closeOnSelect
        onCheckedChange={() => item.onSelect?.()}
      />
    );
  return (
    <MenuItem
      icon={item.icon}
      label={item.label}
      shortcut={item.shortcut}
      disabled={item.disabled}
      danger={item.variant === "danger"}
      onSelect={item.onSelect}
    />
  );
}

/**
 * The toolbar that gives way instead of wrapping or scrolling. It stays one control high, and
 * when it runs out of room it gives way in a fixed order: labels turn into icons (lowest priority
 * first), then the one `shrink` item fades down to its minimum width, then the lowest priority
 * items fold into a trailing ⋯ menu with the same icons and labels. Every bar of actions in the
 * app is one of these.
 */
export function ActionBar({
  label,
  size = "md",
  items,
  end,
  width = "fill",
  className,
}: ActionBarProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const measureRef = React.useRef<HTMLDivElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const [plan, setPlan] = React.useState<ActionBarPlan>(() => allFull(items));
  const [naturalWidth, setNaturalWidth] = React.useState<number | null>(null);
  const control = controlPx[size];
  // The observer reads the latest items without resubscribing on every render.
  const itemsRef = React.useRef(items);
  const itemKey = items.map((item) => `${item.id}${item.render ? "*" : ""}`).join("\n");
  const hasEnd = Boolean(end);

  const measure = React.useCallback(() => {
    const root = rootRef.current;
    const layer = measureRef.current;
    if (!root || !layer) return;
    const current = itemsRef.current;
    const endWidth = widthOf(endRef.current);
    const measured = new Map<string, number>();
    for (const child of Array.from(layer.children)) {
      const key = child.getAttribute("data-measure");
      if (key) measured.set(key, widthOf(child));
    }
    const measures: ActionBarMeasure[] = current.map((item) => ({
      id: item.id,
      priority: item.priority,
      shrink: item.shrink,
      minWidth: item.minWidth,
      full: measured.get(`${item.id}:full`) ?? 0,
      icon: measured.get(`${item.id}:icon`) ?? control,
    }));
    const shrinkId = current.find((item) => item.shrink)?.id;
    const natural =
      measures.reduce((sum, item) => sum + item.full, 0) +
      endWidth +
      Math.max(0, current.length + (endRef.current ? 1 : 0) - 1) * gapPx;
    const rounded = Math.ceil(natural);
    setNaturalWidth((value) => (value === rounded ? value : rounded));
    const available = widthOf(root);
    // Not laid out (hidden, or a test without layout): keep what is shown.
    if (available === 0) return;
    const next = planActionBar({
      available,
      items: measures.map((item) => (item.id === shrinkId ? item : { ...item, shrink: false })),
      more: control,
      end: endWidth,
    });
    setPlan((value) => (samePlan(value, next) ? value : next));
  }, [control]);

  React.useLayoutEffect(() => {
    itemsRef.current = items;
    measure();
  });

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const layer = measureRef.current;
    if (!root || !layer) return;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    // The row's own width, each item's natural width (labels change) and the end slot.
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    for (const child of Array.from(layer.children)) observer.observe(child);
    if (endRef.current) observer.observe(endRef.current);
    return () => observer.disconnect();
  }, [measure, itemKey, hasEnd]);

  const shrinkId = items.find((item) => item.shrink)?.id;
  const folded = items.filter((item) => plan.placements[item.id] === "folded");
  const heightClass = size === "sm" ? "h-6" : "h-8";

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label={label}
      data-slot="action-bar"
      data-size={size}
      className={cn(
        "relative flex min-w-0 shrink items-center gap-1",
        // Every control's content sits 8px in from both its edges, as an icon button's glyph does,
        // so the space between any two controls in the bar is the same.
        "[&_button[data-slot=button]]:px-2",
        heightClass,
        width === "fill" ? "w-full" : "max-w-full",
        plan.overflowing && "overflow-hidden",
        className,
      )}
      style={width === "content" && naturalWidth !== null ? { width: naturalWidth } : undefined}
    >
      {items.map((item) => {
        const placement = plan.placements[item.id] ?? "full";
        if (placement === "folded") return null;
        const shrinking = item.id === shrinkId && plan.shrinkWidth !== null;
        return (
          <div
            key={item.id}
            data-action-bar-item={item.id}
            data-mode={placement}
            className={cn("flex items-center", shrinking ? "min-w-0 shrink" : "shrink-0")}
            style={
              shrinking ? { width: plan.shrinkWidth!, maxWidth: plan.shrinkWidth! } : undefined
            }
          >
            <ItemBody item={item} mode={placement} size={size} shrinking={shrinking} />
          </div>
        );
      })}
      {folded.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More" size={size} variant="quiet" className="shrink-0">
              <MoreHorizontal aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {folded.map((item) => (
              <FoldedItem key={item.id} item={item} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {end ? (
        <div
          ref={endRef}
          data-action-bar-end=""
          className="ml-auto flex shrink-0 items-center gap-1"
        >
          {end}
        </div>
      ) : null}
      {/* Every item at its natural width, out of sight, so the bar knows what it would take to
          show more before showing it. Clipped to the bar so it never adds a scrollbar. */}
      <div
        aria-hidden="true"
        inert
        className="pointer-events-none invisible absolute inset-0 overflow-hidden"
      >
        <div ref={measureRef} className="flex w-max items-center">
          {items.map((item) => (
            <React.Fragment key={item.id}>
              <div data-measure={`${item.id}:full`} className="flex shrink-0 items-center">
                <ItemBody item={item} mode="full" size={size} shrinking={false} />
              </div>
              {/* A plain item's icon form is one control square; only drawn items need measuring. */}
              {item.render ? (
                <div data-measure={`${item.id}:icon`} className="flex shrink-0 items-center">
                  <ItemBody item={item} mode="icon" size={size} shrinking={false} />
                </div>
              ) : null}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
