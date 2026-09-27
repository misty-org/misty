import * as React from "react";
import { cn } from "../utils";

const layerClass = {
  "agent-surface": "layer-agent-surface",
  chrome: "layer-chrome",
  "workspace-overlay": "layer-workspace-overlay",
  "blocking-popup": "layer-blocking-popup",
} as const;

type ViewportLayerProps = React.ComponentPropsWithoutRef<"div"> & {
  /** Which named stacking layer the surface sits on. */
  layer: keyof typeof layerClass;
  /** Click-through: only children that opt back in with pointer-events-auto receive input. */
  passthrough?: boolean;
};

/**
 * A viewport-sized surface for non-modal floating UI (command panels) or full-window
 * takeovers. Modal content belongs in Dialog, Sheet, or WorkspaceOverlay instead.
 */
const ViewportLayer = React.forwardRef<HTMLDivElement, ViewportLayerProps>(
  ({ layer, passthrough = false, className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="viewport-layer"
      className={cn(
        "fixed inset-0",
        layerClass[layer],
        passthrough && "pointer-events-none",
        className,
      )}
      {...props}
    />
  ),
);
ViewportLayer.displayName = "ViewportLayer";

export { ViewportLayer };
