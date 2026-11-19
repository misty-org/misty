import { MoreHorizontal } from "lucide-react";
import * as React from "react";
import { cn } from "../classNames";
import { Button } from "../controls/Button";
import { IconButton } from "../controls/IconButton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../overlays/DropdownMenu";
import { MenuCheckItem, MenuItem, MenuSubmenu } from "../overlays/MenuItem";
import { OverflowFadeText } from "./OverflowFadeText";
import {
  gapPx,
  planActionBar,
  samePlan,
  type ActionBarMeasure,
  type ActionBarPlan,
} from "./actionBarPlan";

export { actionBarGiveWayOrder, planActionBar } from "./actionBarPlan";
export type { ActionBarMeasure, ActionBarPlacement, ActionBarPlan } from "./actionBarPlan";

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

const allFull = (items: ReadonlyArray<ActionBarItem>): ActionBarPlan => ({
  placements: Object.fromEntries(items.map((item) => [item.id, "full" as const])),
  shrinkWidth: null,
  overflowing: false,
});

// Whole pixels: WebKit reports fractional widths that shift by a hair as the bar resizes, and a
// plan made on them can flip with every layout and never settle.
const widthOf = (element: Element | null | undefined) =>
  element ? Math.ceil(element.getBoundingClientRect().width) : 0;

/** How many plans the bar may make in a row before it waits a frame to measure again. */
const maxSyncPlans = 8;

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
  // Plans made since the last frame. A layout that answers each plan with a different width
  // would otherwise re-plan synchronously until React gives up; past the limit the bar waits
  // for the next frame, so at worst it settles a frame late.
  const syncPlans = React.useRef(0);
  const deferred = React.useRef(false);
  const frame = React.useRef(0);
  const measureLater = React.useRef<() => void>(() => {});
  // What is shown now, so a measure knows whether it changes anything.
  const shownPlan = React.useRef(plan);
  shownPlan.current = plan;
  const shownNatural = React.useRef(naturalWidth);
  shownNatural.current = naturalWidth;
  React.useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const nextFrame = React.useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      syncPlans.current = 0;
      if (deferred.current) {
        deferred.current = false;
        measureLater.current();
      }
    });
  }, []);

  const measure = React.useCallback(() => {
    const root = rootRef.current;
    const layer = measureRef.current;
    if (!root || !layer) return;
    if (syncPlans.current >= maxSyncPlans) {
      deferred.current = true;
      nextFrame();
      return;
    }
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
    let changed = false;
    if (shownNatural.current !== rounded) {
      shownNatural.current = rounded;
      setNaturalWidth(rounded);
      changed = true;
    }
    // Not laid out (hidden, or a test without layout): keep what is shown.
    const available = root.getBoundingClientRect().width;
    if (available > 0) {
      const next = planActionBar({
        // Within a pixel counts as fitting, so the bar sized to its own width always fits it.
        available: Math.round(available) + 1,
        items: measures.map((item) => (item.id === shrinkId ? item : { ...item, shrink: false })),
        more: control,
        end: endWidth,
      });
      if (!samePlan(shownPlan.current, next)) {
        shownPlan.current = next;
        setPlan(next);
        changed = true;
      }
    }
    if (changed) {
      syncPlans.current += 1;
      nextFrame();
    }
  }, [control, nextFrame]);
  measureLater.current = measure;

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
