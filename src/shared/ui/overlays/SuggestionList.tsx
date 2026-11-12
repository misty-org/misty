import * as React from "react";
import { cn } from "../classNames";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import { MenuIconSlot, type MenuIcon } from "./MenuItem";
import { menuItemClass, menuLabelTextClass, menuListClass, popupSurfaceClass } from "./popupStyles";

/**
 * The popup under a combobox field (composer mentions, search boxes). Focus stays in the field,
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

type SuggestionItemBaseProps = Omit<React.ComponentPropsWithoutRef<"div">, "role" | "children"> & {
  selected: boolean;
  ref?: React.Ref<HTMLDivElement>;
};

type SuggestionItemProps = SuggestionItemBaseProps & {
  /** The 16px icon (or an avatar) the row starts with. */
  icon: MenuIcon;
  /** The row's text, which fades at its end when the list is narrow. */
  label: React.ReactNode;
  /**
   * Muted text after the label, such as a kind, a role or a description. It takes at most half
   * the row and fades at its end.
   */
  detail?: React.ReactNode;
};

/**
 * One option in a SuggestionList: icon · label · detail, like a menu row.
 *
 * ```tsx
 * <SuggestionItem icon={FileText} label={file.name} detail="File" selected={index === active} />
 * ```
 */
function SuggestionItem({
  className,
  selected,
  onPointerDown,
  icon,
  label,
  detail,
  ref,
  ...props
}: SuggestionItemProps) {
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      data-slot="suggestion-item"
      className={cn(menuItemClass, "group/suggestion", selected && "bg-charcoal-hover", className)}
      // Keep focus in the field so choosing a row does not blur it first.
      onPointerDown={(event) => {
        event.preventDefault();
        onPointerDown?.(event);
      }}
      {...props}
    >
      <MenuIconSlot icon={icon} />
      <OverflowFadeText className={menuLabelTextClass}>{label}</OverflowFadeText>
      {detail ? (
        <OverflowFadeText
          data-slot="suggestion-detail"
          className="ml-auto max-w-1/2 shrink pl-2 text-meta text-cream-muted"
        >
          {detail}
        </OverflowFadeText>
      ) : null}
    </div>
  );
}

export { SuggestionItem, SuggestionList };
export type { SuggestionItemProps };
