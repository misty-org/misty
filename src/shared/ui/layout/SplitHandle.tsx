import { PanelResizeHandle } from "react-resizable-panels";
import { cn } from "../classNames";

/**
 * The seam between two resizable panes. Nothing shows at rest: the panes meet edge to edge. A
 * wider grab area sits around the 1px seam, and a hairline shows while it is hovered, focused or
 * dragged. `direction` is the split's: "horizontal" panes sit side by side.
 */
export function SplitHandle(props: { direction: "horizontal" | "vertical"; label: string }) {
  return (
    <PanelResizeHandle
      aria-label={props.label}
      className={cn(
        "relative z-20 bg-transparent transition-colors",
        "hover:bg-charcoal-border data-[resize-handle-state=drag]:bg-charcoal-border",
        "focus-visible:bg-charcoal-border focus-visible:outline-none",
        "before:absolute before:content-['']",
        props.direction === "horizontal"
          ? "w-px cursor-col-resize before:-inset-x-1 before:inset-y-0"
          : "h-px cursor-row-resize before:inset-x-0 before:-inset-y-1",
      )}
    />
  );
}
