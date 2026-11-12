import * as React from "react";
import { cn } from "../classNames";

/**
 * A clickable surface whose content is its look: a card, a calendar event, a tab, a canvas
 * item. It adds only button semantics and disabled handling; the content draws its own hover
 * and focus states, since focus rings are off app-wide. Anything that looks like a button uses
 * Button or IconButton instead.
 */
const Pressable = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<"button">>(
  ({ className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="pressable"
      className={cn(
        "cursor-pointer text-left outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Pressable.displayName = "Pressable";

export { Pressable };
