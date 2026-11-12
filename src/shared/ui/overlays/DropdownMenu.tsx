import { useOverlaySide } from "./OverlaySide";
import {
  MenuKindContext,
  menuContentClass,
  menuIndicatorClass,
  menuIndicatorItemClass,
  menuItemClass,
  menuLabelClass,
  menuSeparatorClass,
  menuWidthClass,
  type MenuWidth,
} from "./popupStyles";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "../classNames";

/*
 * Radix's dropdown parts with Misty's look. Features build rows with MenuItem, MenuCheckItem,
 * MenuRadioGroup/MenuRadioItem and MenuSubmenu (MenuItem.tsx); the raw Item, CheckboxItem,
 * RadioItem and SubTrigger below stay for those components and for code not yet moved.
 */

const dropdownViewportClass =
  "max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] max-w-[var(--radix-dropdown-menu-content-available-width)]";

/** `danger` paints the row red, for deleting. */
type MenuItemVariant = "default" | "danger";

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuRadioGroup = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioGroup>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioGroup>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioGroup ref={ref} className={cn("grid gap-1", className)} {...props} />
));
DropdownMenuRadioGroup.displayName = DropdownMenuPrimitive.RadioGroup.displayName;

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    variant?: MenuItemVariant;
  }
>(({ className, children, variant = "default", ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    data-slot="dropdown-menu-sub-trigger"
    data-variant={variant}
    className={cn(menuItemClass, className)}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto text-cream-muted" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      data-slot="dropdown-menu-sub-content"
      collisionPadding={8}
      className={cn(menuContentClass, dropdownViewportClass, className)}
      {...props}
    >
      <MenuKindContext.Provider value="dropdown">{children}</MenuKindContext.Provider>
    </DropdownMenuPrimitive.SubContent>
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & { width?: MenuWidth }
>(({ className, align = "start", side, sideOffset = 4, width, children, ...props }, ref) => {
  const placement = useOverlaySide();
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        data-slot="dropdown-menu-content"
        side={side ?? placement}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn(
          menuContentClass,
          dropdownViewportClass,
          width && menuWidthClass[width],
          className,
        )}
        {...props}
      >
        <MenuKindContext.Provider value="dropdown">{children}</MenuKindContext.Provider>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    variant?: MenuItemVariant;
  }
>(({ className, variant = "default", ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    data-slot="dropdown-menu-item"
    data-variant={variant}
    className={cn(menuItemClass, className)}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    data-slot="dropdown-menu-checkbox-item"
    className={cn(menuIndicatorItemClass, className)}
    checked={checked}
    {...props}
  >
    {children}
    <span data-slot="dropdown-menu-checkbox-item-indicator" className={menuIndicatorClass}>
      <DropdownMenuPrimitive.ItemIndicator>
        <Check />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    data-slot="dropdown-menu-radio-item"
    className={cn(menuIndicatorItemClass, className)}
    {...props}
  >
    {children}
    <span data-slot="dropdown-menu-radio-item-indicator" className={menuIndicatorClass}>
      <DropdownMenuPrimitive.ItemIndicator>
        <Check />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    data-slot="dropdown-menu-label"
    className={cn(menuLabelClass, className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    data-slot="dropdown-menu-separator"
    className={cn(menuSeparatorClass, className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
export type { MenuItemVariant };
