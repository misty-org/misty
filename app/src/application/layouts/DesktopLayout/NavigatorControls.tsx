import { cn } from "@/shared/ui";
import { useShortcutTitle } from "@/features/shortcuts";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { NavigatorLayout, NavigatorVisibility } from "./navigatorMode";

const controlButtonClass = [
  "grid size-7 place-items-center rounded-md border-0 bg-transparent p-0 text-cream-muted",
  "transition-colors hover:bg-charcoal-card hover:text-cream-bright",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal-active",
].join(" ");

/**
 * Navigator visibility toggle: decides whether the sidebar holds its column (sticky)
 * or slides away (hidden) until the edge is hovered.
 */
export function NavigatorControls(props: {
  layout?: NavigatorLayout;
  visibility?: NavigatorVisibility;
  onToggleVisibility: () => void;
  className?: string;
}) {
  const sticky = (props.visibility ?? props.layout?.visibility ?? "sticky") === "sticky";
  const title = useShortcutTitle(sticky ? "Hide sidebar" : "Show sidebar", "app.toggle_navigator");
  return (
    <div className={cn("flex items-center", props.className)} data-misty-window-drag-block="true">
      <button
        type="button"
        className={controlButtonClass}
        aria-pressed={sticky}
        aria-label={sticky ? "Hide sidebar" : "Show sidebar"}
        title={title}
        onClick={props.onToggleVisibility}
      >
        {sticky ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
      </button>
    </div>
  );
}
