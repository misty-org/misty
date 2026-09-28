import { cn, IconButton } from "@/shared/ui";
import { useShortcutTitle } from "@/features/shortcuts";
import { PanelLeft } from "lucide-react";
import type { DockPosition } from "@/features/app-shell/dockingLayout";

/** Toggle the thin rail between always visible and edge-hover auto-hide. */
export function NavigatorControls(props: {
  position?: DockPosition;
  autoHide: boolean;
  onToggleAutoHide: () => void;
  className?: string;
}) {
  const rotation = { left: "", right: "rotate-180", top: "rotate-90", bottom: "-rotate-90" }[
    props.position ?? "left"
  ];
  const title = useShortcutTitle(
    props.autoHide ? "Keep navigation visible" : "Auto-hide navigation",
    "app.toggle_navigator",
  );
  return (
    <div className={cn("flex items-center", props.className)} data-misty-window-drag-block="true">
      <IconButton
        size="xs"
        className="misty-navigator-icon-target aria-pressed:bg-transparent aria-pressed:hover:bg-control-hover"
        label="Auto-hide navigation"
        data-navigator-visibility-toggle
        aria-pressed={props.autoHide}
        tooltip={title}
        onClick={props.onToggleAutoHide}
      >
        <PanelLeft className={cn("size-4", rotation)} size={16} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
