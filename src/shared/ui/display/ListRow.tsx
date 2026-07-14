import * as React from "react";
import { cn } from "../utils";

/** A hoverable list row: leading icon, a primary ListRowButton, then trailing actions. */
const ListRow = React.forwardRef<HTMLLIElement, React.ComponentPropsWithoutRef<"li">>(
  ({ className, ...props }, ref) => (
    <li
      ref={ref}
      data-slot="list-row"
      className={cn(
        "group/row flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5",
        "hover:bg-cream/[0.045] focus-within:bg-cream/[0.045]",
        className,
      )}
      {...props}
    />
  ),
);
ListRow.displayName = "ListRow";

/** The row's main click target; the row itself supplies the hover. */
const ListRowButton = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<"button">>(
  ({ className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="list-row-button"
      className={cn(
        "flex min-w-0 flex-1 items-baseline gap-2 rounded-sm text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-cream/15 disabled:cursor-default",
        className,
      )}
      {...props}
    />
  ),
);
ListRowButton.displayName = "ListRowButton";

export { ListRow, ListRowButton };
