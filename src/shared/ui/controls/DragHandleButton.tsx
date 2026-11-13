import * as React from "react";

import { cn } from "../classNames";
import { IconButton, type IconButtonProps } from "./IconButton";

export type DragHandleButtonProps = Omit<IconButtonProps, "aria-label" | "asChild">;

/**
 * An icon button that lives inside an HTML5-draggable surface (editor block handles, pinned rows).
 * WebKit will not start a drag from a `user-select: none` element, so this gives back the text
 * selection Button turns off; otherwise it is the quiet 24px IconButton.
 */
const DragHandleButton = React.forwardRef<HTMLButtonElement, DragHandleButtonProps>(
  ({ className, size = "sm", ...props }, ref) => (
    <IconButton
      ref={ref}
      data-slot="drag-handle-button"
      size={size}
      className={cn("select-auto", className)}
      {...props}
    />
  ),
);
DragHandleButton.displayName = "DragHandleButton";

export { DragHandleButton };
