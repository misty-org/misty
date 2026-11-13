"use client";

import { Command as CommandPrimitive } from "cmdk";
import { Check, Search } from "lucide-react";
import * as React from "react";

import { cn } from "../classNames";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import { MenuIconSlot, type MenuIcon } from "./MenuItem";
import {
  menuIndicatorClass,
  menuLabelTextClass,
  menuRowClass,
  menuSeparatorClass,
  menuShortcutClass,
  pickerSearchInputClass,
  pickerSearchRowClass,
} from "./popupStyles";
import { Tooltip } from "./Tooltip";

/*
 * A searchable list (cmdk) for pickers and palettes. Its rows are menu rows: a 16px icon, the
 * label, an optional shortcut, and a checkmark at the right edge for the current pick.
 */

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-charcoal-card text-control text-cream",
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className={pickerSearchRowClass} cmdk-input-wrapper="">
    <Search aria-hidden className="size-4 shrink-0 text-cream-muted" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(pickerSearchInputClass, className)}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-72 overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

/** The one muted line when nothing matches the search. */
const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn("px-2 py-6 text-center text-control text-cream-muted", className)}
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-cream [&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:gap-1",
      // The heading reads like a menu label (menuLabelClass).
      "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-meta",
      "[&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-cream-muted",
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator ref={ref} className={cn(menuSeparatorClass, className)} {...props} />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

// cmdk marks state with data-selected / data-disabled set to "true" or "false", not by presence.
const commandItemClass = cn(
  menuRowClass,
  "data-[selected=true]:bg-charcoal-hover",
  "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
);

type RadixCommandItemProps = Omit<
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>,
  "children" | "asChild"
> & {
  /** Why a disabled row can't be used, shown in a tooltip while it is hovered. */
  reason?: string;
  ref?: React.Ref<HTMLDivElement>;
};

type CommandItemProps = RadixCommandItemProps & {
  /** The 16px icon, only when it tells the row apart from the others. */
  icon?: MenuIcon;
  /** The row's text. It is also what the search matches unless `value` is given. */
  label: React.ReactNode;
  /** A muted line under the label, such as what an action does; the row grows to two lines. */
  description?: string;
  /** Muted text at the right end, such as a time or a state. */
  shortcut?: React.ReactNode;
  /**
   * A control at the right end, before the checkmark, such as the item's settings button. Its
   * clicks don't pick the row.
   */
  end?: React.ReactNode;
  /** The current pick: a checkmark at the right edge. */
  checked?: boolean;
};

/**
 * One row of a Command list.
 *
 * ```tsx
 * <CommandItem label={agent.name} checked={agent.id === current} onSelect={() => pick(agent.id)} />
 * ```
 */
function CommandItem({
  className,
  icon,
  label,
  description,
  shortcut,
  end,
  checked,
  reason,
  disabled,
  ref,
  ...props
}: CommandItemProps) {
  const explained = disabled && reason ? reason : undefined;
  const item = (
    <CommandPrimitive.Item
      ref={ref}
      disabled={disabled}
      data-checked={checked || undefined}
      className={cn(
        commandItemClass,
        checked !== undefined && "pr-8",
        explained && "data-[disabled=true]:pointer-events-auto",
        className,
      )}
      {...props}
    >
      <MenuIconSlot icon={icon} />
      {description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <OverflowFadeText>{label}</OverflowFadeText>
          <OverflowFadeText
            data-slot="command-item-description"
            className="text-meta text-cream-muted"
          >
            {description}
          </OverflowFadeText>
        </span>
      ) : (
        <OverflowFadeText className={menuLabelTextClass}>{label}</OverflowFadeText>
      )}
      {shortcut ? <span className={menuShortcutClass}>{shortcut}</span> : null}
      {end ? (
        <span
          data-slot="command-item-end"
          className="flex shrink-0 items-center"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {end}
        </span>
      ) : null}
      {checked ? (
        <span className={menuIndicatorClass}>
          <Check />
        </span>
      ) : null}
    </CommandPrimitive.Item>
  );
  if (!explained) return item;
  return (
    <Tooltip content={explained} side="right">
      {item}
    </Tooltip>
  );
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
};
export type { CommandItemProps };
