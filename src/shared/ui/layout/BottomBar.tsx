import type { ReactNode } from "react";
import { cn } from "../classNames";
import { CompactControls } from "../controls/RowContext";
import { SidewaysScroll } from "./SidewaysScroll";

/**
 * The bar along the bottom of the window, a popup or an overlay, which keeps room there so nothing
 * floats over the content. A hairline along its top sets it off from the content, the way a top
 * bar's closes it. It is lighter than a top bar: compact by default (32px, its buttons 24px), or
 * `standard` (40px, its buttons 32px) where the person chose that for the window's bar.
 * Its controls are centered in it, 12px in from the right, the "i" for the surface's tour last.
 * `start` holds anything that belongs at its other end. When the two ends don't fit side by side,
 * the bar scrolls sideways (SidewaysScroll) rather than shrink its items or let one end slide
 * over the other.
 *
 * ```tsx
 * <BottomBar aria-label="Layout">
 *   <TourInfoButton tour="layout" />
 * </BottomBar>
 * ```
 */
export function BottomBar(props: {
  children?: ReactNode;
  start?: ReactNode;
  size?: "compact" | "standard";
  "aria-label"?: string;
  "data-tour"?: string;
}) {
  const compact = (props.size ?? "compact") === "compact";
  return (
    <footer
      data-slot="bottom-bar"
      data-size={compact ? "compact" : "standard"}
      aria-label={props["aria-label"]}
      data-tour={props["data-tour"]}
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-2 border-t border-charcoal-border px-3",
        compact ? "h-(--ui-bottom-bar)" : "h-(--ui-bottom-bar-standard)",
      )}
    >
      <CompactControls on={compact}>
        <SidewaysScroll className="flex-1 gap-2 self-stretch">
          {/* Never narrower than its items: past that the row scrolls instead. */}
          {props.start ? (
            <div className="flex flex-[1_0_auto] items-center gap-2 self-stretch">
              {props.start}
            </div>
          ) : null}
          <div className="ml-auto flex flex-none items-center gap-2">{props.children}</div>
        </SidewaysScroll>
      </CompactControls>
    </footer>
  );
}
