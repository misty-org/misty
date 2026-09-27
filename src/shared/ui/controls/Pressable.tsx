import * as React from "react";
import { cn } from "../utils";

/**
 * A clickable surface whose content is its look: a card, a calendar event, a tab, a canvas
 * item. It adds only button semantics, the shared focus ring, and disabled handling.
 * Anything that looks like a button uses Button or IconButton instead.
 */
const Pressable = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<"button">>(
  ({ className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="pressable"
      className={cn(
        "cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-cream/15",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Pressable.displayName = "Pressable";

export { Pressable };
