import * as React from "react";

import { cn } from "@/ui";

/**
 * Full-viewport shield that captures pointer events while an app-managed drag
 * is in flight. Rendered only for the duration of the drag.
 */
const DragInteractionShield = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    data-slot="drag-interaction-shield"
    className={cn(
      "pointer-events-auto fixed inset-0 z-[2147483400] cursor-grabbing bg-transparent",
      className,
    )}
    {...props}
  />
));
DragInteractionShield.displayName = "DragInteractionShield";

/**
 * Floating card that follows the pointer during an app-managed drag. Position
 * it with `style={{ left, top }}` from the active pointer location.
 */
const DragPreviewCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="drag-preview-card"
      className={cn(
        "pointer-events-none fixed z-[2147483500] max-w-64 rounded-lg bg-charcoal-card px-3 py-2 text-xs font-semibold text-cream shadow-md ring-1 ring-cream/10",
        className,
      )}
      {...props}
    />
  ),
);
DragPreviewCard.displayName = "DragPreviewCard";

export { DragInteractionShield, DragPreviewCard };
