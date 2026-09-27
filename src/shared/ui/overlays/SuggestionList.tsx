import * as React from "react";
import { cn } from "../utils";
import { menuItemClass, menuListClass, popupSurfaceClass } from "./popupStyles";

/**
 * The popup under a combobox field (address bar, search boxes). Focus stays in the field,
 * so rows are options highlighted by `selected` rather than focusable menu items.
 */
const SuggestionList = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="listbox"
      data-slot="suggestion-list"
      className={cn("overflow-hidden", popupSurfaceClass, menuListClass, className)}
      {...props}
    />
  ),
);
SuggestionList.displayName = "SuggestionList";

type SuggestionItemProps = Omit<React.ComponentPropsWithoutRef<"div">, "role"> & {
  selected: boolean;
};

const SuggestionItem = React.forwardRef<HTMLDivElement, SuggestionItemProps>(
  ({ className, selected, onPointerDown, ...props }, ref) => (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      data-slot="suggestion-item"
      className={cn(
        menuItemClass,
        "group/suggestion gap-3",
        selected && "bg-charcoal-hover",
        className,
      )}
      // Keep focus in the field so choosing a row does not blur it first.
      onPointerDown={(event) => {
        event.preventDefault();
        onPointerDown?.(event);
      }}
      {...props}
    />
  ),
);
SuggestionItem.displayName = "SuggestionItem";

export { SuggestionItem, SuggestionList };
