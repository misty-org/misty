"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown, ChevronUp, Check } from "lucide-react";
import * as React from "react";

import { OverflowFadeText } from "../layout/OverflowFadeText";
import { MenuChevron } from "../overlays/MenuChevron";
import { MenuIconSlot, type MenuIcon } from "../overlays/MenuItem";
import {
  menuIndicatorClass,
  menuIndicatorItemClass,
  menuItemExplainedClass,
  menuLabelClass,
  menuLabelTextClass,
  menuListClass,
  menuSeparatorClass,
  popupMotionClass,
  popupSurfaceClass,
} from "../overlays/popupStyles";
import { Tooltip } from "../overlays/Tooltip";
import { cn } from "../classNames";

/*
 * A field that picks one value from a list. The rows follow the menu rules: a 16px icon, the
 * label, and a checkmark at the right edge for the one picked. The trigger shows the picked
 * row's icon and label. OptionSelect builds the whole thing from a list of options.
 */

const Select = SelectPrimitive.Root;

const SelectValue = SelectPrimitive.Value;

const SelectGroup = SelectPrimitive.Group;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    data-slot="select-trigger"
    className={cn(
      // 32px, the height of every control it shares a row with.
      "flex h-8 w-full min-w-0 items-center justify-between gap-2 whitespace-nowrap rounded-md border",
      "border-charcoal-border-strong bg-charcoal-card px-2.5 text-left text-control text-cream",
      "transition-colors outline-none hover:border-charcoal-active",
      "focus-visible:ring-3 focus-visible:ring-charcoal-active/50",
      "data-[placeholder]:text-cream-muted disabled:cursor-not-allowed disabled:opacity-50",
      "aria-invalid:border-danger",
      // The picked value: its icon and its label, which fades when the field is narrow.
      "[&>span]:flex [&>span]:min-w-0 [&>span]:flex-1 [&>span]:items-center [&>span]:gap-2",
      "[&>span]:overflow-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0",
      "[&_svg:not([class*='size-'])]:size-4",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <MenuChevron className="size-4 text-cream-muted" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="size-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="size-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      data-slot="select-content"
      className={cn(
        "relative layer-popover max-h-[min(24rem,calc(100dvh-2rem))] min-w-32 overflow-x-hidden overflow-y-auto",
        popupSurfaceClass,
        popupMotionClass,
        position === "popper" && "max-h-[min(24rem,var(--radix-select-content-available-height))]",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1",
        position === "popper" && "data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className,
      )}
      position={position}
      collisionPadding={8}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          menuListClass,
          position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]",
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

type RadixSelectItemProps = Omit<
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>,
  "children" | "asChild"
> & {
  /** Why a disabled row can't be picked, shown in a tooltip while it is hovered. */
  reason?: string;
  ref?: React.Ref<HTMLDivElement>;
};

type SelectItemProps = RadixSelectItemProps & {
  /** The 16px icon every row starts with; the trigger shows it too once picked. */
  icon: MenuIcon;
  /** The row's text, which fades at its end when the list is narrow. */
  label: React.ReactNode;
};

/**
 * One choice in a Select: icon · label, with a checkmark at the right edge while picked.
 *
 * ```tsx
 * <SelectItem value="grid" icon={LayoutGrid} label="Grid" />
 * ```
 */
function SelectItem({ className, icon, label, reason, disabled, ref, ...props }: SelectItemProps) {
  const explained = disabled && reason ? reason : undefined;
  const item = (
    <SelectPrimitive.Item
      ref={ref}
      data-slot="select-item"
      disabled={disabled}
      className={cn(menuIndicatorItemClass, explained && menuItemExplainedClass, className)}
      {...props}
    >
      <SelectPrimitive.ItemText asChild>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <MenuIconSlot icon={icon} />
          <OverflowFadeText className={menuLabelTextClass}>{label}</OverflowFadeText>
        </span>
      </SelectPrimitive.ItemText>
      <span className={menuIndicatorClass}>
        <SelectPrimitive.ItemIndicator>
          <Check />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
  if (!explained) return item;
  return (
    <Tooltip content={explained} side="right">
      {item}
    </Tooltip>
  );
}

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn(menuLabelClass, className)} {...props} />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn(menuSeparatorClass, className)} {...props} />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
export type { SelectItemProps };
