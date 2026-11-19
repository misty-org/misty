import type { ComponentProps, WheelEvent } from "react";
import { cn } from "../classNames";

/** A mouse wheel's vertical turn scrolls the row sideways; a trackpad's sideways swipe already does. */
function scrollSideways(event: WheelEvent<HTMLDivElement>) {
  const row = event.currentTarget;
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || row.scrollWidth <= row.clientWidth)
    return;
  // Line-based wheels (deltaMode 1) count lines, not pixels.
  row.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : 1);
}

/**
 * A row of a bar that scrolls sideways when its items don't fit, instead of letting them overlap
 * or spill past its edge: no scrollbar shows (it would take the bar's room), and a mouse wheel
 * scrolls it as a trackpad swipe does. The window's top and bottom bars hold their items in one.
 *
 * ```tsx
 * <SidewaysScroll className="flex-1 gap-2">{items}</SidewaysScroll>
 * ```
 */
export function SidewaysScroll({ className, onWheel, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      onWheel={(event) => {
        onWheel?.(event);
        scrollSideways(event);
      }}
      className={cn(
        "flex min-w-0 items-center overflow-x-auto overflow-y-hidden scrollbar-none",
        className,
      )}
    />
  );
}
