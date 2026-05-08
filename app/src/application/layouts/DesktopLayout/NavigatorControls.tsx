import { cn } from "@/shared/ui";
import { PanelLeft, PanelLeftClose, Pin, PinOff } from "lucide-react";
import type { NavigatorLayout } from "./navigatorMode";

const controlButtonClass = [
  "grid size-7 place-items-center rounded-md border-0 bg-transparent p-0 text-cream-muted",
  "transition-colors hover:bg-charcoal-card hover:text-cream-bright",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal-active",
].join(" ");

/**
 * Two independent navigator switches: one cycles the width, the other decides
 * whether the rail holds its column or slides away until the edge is hovered.
 */
export function NavigatorControls(props: {
  layout: NavigatorLayout;
  onCycleWidth: () => void;
  onToggleVisibility: () => void;
  className?: string;
}) {
  const full = props.layout.width === "full";
  const sticky = props.layout.visibility === "sticky";
  return (
    <div
      className={cn("flex items-center gap-0.5", props.className)}
      data-misty-window-drag-block="true"
    >
      <button
        type="button"
        className={controlButtonClass}
        aria-label={`Navigation width: ${full ? "Full" : "Icons"}`}
        title={full ? "Switch to icons" : "Switch to full width"}
        onClick={props.onCycleWidth}
      >
        {full ? <PanelLeft size={17} /> : <PanelLeftClose size={17} />}
      </button>
      <button
        type="button"
        className={controlButtonClass}
        aria-pressed={sticky}
        aria-label={`Navigation is ${sticky ? "sticky" : "hidden"}`}
        title={sticky ? "Auto-hide navigation (⌘⇧B)" : "Keep navigation open (⌘⇧B)"}
        onClick={props.onToggleVisibility}
      >
        {sticky ? <Pin size={16} /> : <PinOff size={16} />}
      </button>
    </div>
  );
}
