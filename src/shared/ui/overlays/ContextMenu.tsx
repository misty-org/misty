"use client";

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
import type { MenuItemVariant } from "./DropdownMenu";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "../classNames";

/*
 * Radix's right-click menu with the same rows as the dropdown. Features put MenuItem,
 * MenuCheckItem, MenuRadioGroup/MenuRadioItem and MenuSubmenu inside ContextMenuContent; those
 * read the menu kind from it, so the same tree also works inside a DropdownMenu.
 */

const contextViewportClass =
  "max-h-[min(24rem,var(--radix-context-menu-content-available-height))] max-w-[var(--radix-context-menu-content-available-width)]";

const ContextMenu = ContextMenuPrimitive.Root;

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuGroup = ContextMenuPrimitive.Group;

const ContextMenuRadioGroup = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioGroup>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioGroup>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.RadioGroup ref={ref} className={cn("grid gap-1", className)} {...props} />
));
ContextMenuRadioGroup.displayName = ContextMenuPrimitive.RadioGroup.displayName;

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    variant?: MenuItemVariant;
  }
>(({ className, variant = "default", children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    data-slot="context-menu-sub-trigger"
    data-variant={variant}
    className={cn(menuItemClass, className)}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto text-cream-muted" />
  </ContextMenuPrimitive.SubTrigger>
));
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.SubContent
      ref={ref}
      data-slot="context-menu-sub-content"
      collisionPadding={8}
      className={cn(menuContentClass, contextViewportClass, className)}
      {...props}
    >
      <MenuKindContext.Provider value="context">{children}</MenuKindContext.Provider>
    </ContextMenuPrimitive.SubContent>
  </ContextMenuPrimitive.Portal>
));
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content> & { width?: MenuWidth }
>(({ className, width, children, collisionPadding = 8, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      data-slot="context-menu-content"
      collisionPadding={collisionPadding}
      className={cn(
        menuContentClass,
        contextViewportClass,
        width && menuWidthClass[width],
        className,
      )}
      {...props}
    >
      <MenuKindContext.Provider value="context">{children}</MenuKindContext.Provider>
    </ContextMenuPrimitive.Content>
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    variant?: MenuItemVariant;
  }
>(({ className, variant = "default", ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    data-slot="context-menu-item"
    data-variant={variant}
    className={cn(menuItemClass, className)}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    data-slot="context-menu-checkbox-item"
    className={cn(menuIndicatorItemClass, className)}
    {...props}
  >
    {children}
    <span className={menuIndicatorClass}>
      <ContextMenuPrimitive.ItemIndicator>
        <Check />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
  </ContextMenuPrimitive.CheckboxItem>
));
ContextMenuCheckboxItem.displayName = ContextMenuPrimitive.CheckboxItem.displayName;

const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    data-slot="context-menu-radio-item"
    className={cn(menuIndicatorItemClass, className)}
    {...props}
  >
    {children}
    <span className={menuIndicatorClass}>
      <ContextMenuPrimitive.ItemIndicator>
        <Check />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    data-slot="context-menu-label"
    className={cn(menuLabelClass, className)}
    {...props}
  />
));
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    data-slot="context-menu-separator"
    className={cn(menuSeparatorClass, className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};
