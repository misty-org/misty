import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Button, cn } from "@/shared/ui";
import { useShortcutTitle } from "@/features/shortcuts";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { DockPosition } from "@/features/app-shell/dockingLayout";
import type { NavigatorLayout, NavigatorVisibility } from "./navigatorMode";
import { navigatorFocusRingClass } from "./styles";

const controlButtonClass = [
  "misty-navigator-icon-target grid size-7 place-items-center rounded-md border-0 bg-transparent p-0 text-cream-muted",
  "transition-colors hover:bg-charcoal-card hover:text-cream-bright",
  navigatorFocusRingClass,
].join(" ");

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
      <TooltipProvider delayDuration={450}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={controlButtonClass}
              aria-pressed={sticky}
              aria-label={sticky ? "Hide navigation" : "Show navigation"}
              onClick={props.onToggleVisibility}
            >
              {sticky ? (
                <PanelLeftClose
                  className={rotation}
                  size={props.iconSize ?? 18}
                  aria-hidden="true"
                />
              ) : (
                <PanelLeftOpen
                  className={rotation}
                  size={props.iconSize ?? 18}
                  aria-hidden="true"
                />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{title}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
