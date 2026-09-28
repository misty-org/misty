import * as React from "react";
import { cn } from "../utils";

/**
 * An icon button that lives inside an HTML5-draggable surface (editor block handles).
 * WebKit will not start a drag from a `user-select: none` element, so this deliberately
 * skips Button's select-none; otherwise it matches the toolbar IconButton look.
 */
const DragHandleButton = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentPropsWithoutRef<"button">, "aria-label"> & { label: string }
>(({ label, className, type = "button", title, ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    data-slot="drag-handle-button"
    aria-label={label}
    title={title ?? label}
    className={cn(
      "grid h-[30px] w-[27px] shrink-0 place-items-center rounded-md border-0 bg-transparent p-0",
      "text-cream-muted outline-none transition-colors hover:bg-control-hover hover:text-cream",
      "focus-visible:ring-2 focus-visible:ring-cream/15 data-[state=open]:bg-control-active",
      "[&_svg]:pointer-events-none [&_svg]:size-4",
      className,
    )}
    {...props}
  />
));
DragHandleButton.displayName = "DragHandleButton";

export { DragHandleButton };
