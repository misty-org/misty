import { cn, IconButton } from "@/shared/ui";
import { useShortcutTitle } from "@/features/shortcuts";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { DockPosition } from "@/features/app-shell/dockingLayout";
import type { NavigatorLayout, NavigatorVisibility } from "./navigatorMode";

/**
 * Navigator visibility toggle: decides whether the sidebar holds its column (sticky)
 * or slides away (hidden) until the edge is hovered.
 */
export function NavigatorControls(props: {
  position?: DockPosition;
  iconSize?: number;
  layout?: NavigatorLayout;
  visibility?: NavigatorVisibility;
  onToggleVisibility: () => void;
  className?: string;
}) {
  const rotation = { left: "", right: "rotate-180", top: "rotate-90", bottom: "-rotate-90" }[
    props.position ?? "left"
  ];
  const sticky = (props.visibility ?? props.layout?.visibility ?? "sticky") === "sticky";
  const title = useShortcutTitle(
    sticky ? "Hide navigation" : "Show navigation",
    "app.toggle_navigator",
  );
  return (
    <div className={cn("flex items-center", props.className)} data-misty-window-drag-block="true">
      <IconButton
        // Pressed means the navigator holds its column; that is the resting state, so no fill.
        className="misty-navigator-icon-target aria-pressed:bg-transparent aria-pressed:hover:bg-cream/[0.045]"
        aria-pressed={sticky}
        label={sticky ? "Hide navigation" : "Show navigation"}
        tooltip={title}
        onClick={props.onToggleVisibility}
      >
        {sticky ? (
          <PanelLeftClose className={rotation} size={props.iconSize ?? 18} aria-hidden="true" />
        ) : (
          <PanelLeftOpen className={rotation} size={props.iconSize ?? 18} aria-hidden="true" />
        )}
      </IconButton>
    </div>
  );
}
