import { Command as CommandPrimitive } from "cmdk";
import * as React from "react";

import { cn } from "../classNames";
import { Pressable } from "../controls/Pressable";

/*
 * The parts of a full command palette in a dialog (⌘K), larger than a picker's Command: a wide
 * search box with no icon or frame, a row of type tabs, muted group headings and rows of 40px
 * (two lines with an excerpt). They keep the dialog's body line height, so a heading or a
 * two-line row is as tall as the dialog's own text. Layout inside a row is the caller's; cmdk's
 * own `Command` and `Command.Group` hold them.
 */

/** The palette's search box: the body role in the bright text, a muted placeholder, no frame. */
const CommandPaletteInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Input
    ref={ref}
    className={cn(
      "w-full bg-transparent text-body text-cream-bright outline-none placeholder:text-cream-muted",
      className,
    )}
    {...props}
  />
));
CommandPaletteInput.displayName = "CommandPaletteInput";

/**
 * One of the palette's type tabs (All, Chats, Docs…): 28px, the meta role, muted until hovered;
 * the picked one (`aria-selected`) takes the control wash and the bright text.
 */
function CommandPaletteTab({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Pressable> & { ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <Pressable
      type="button"
      role="tab"
      className={cn(
        "h-7 rounded-md px-2.5 text-meta text-cream-muted hover:text-cream",
        "aria-selected:bg-control-hover aria-selected:text-cream-bright",
        className,
      )}
      {...props}
    />
  );
}

/** The palette's list: it scrolls, and its group headings are muted captions. */
const CommandPaletteList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      "overflow-y-auto",
      "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5",
      "[&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:leading-(--text-body--line-height)",
      "[&_[cmdk-group-heading]]:text-cream-muted",
      className,
    )}
    {...props}
  />
));
CommandPaletteList.displayName = "CommandPaletteList";

type CommandPaletteItemProps = React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item> & {
  /** A row with the words around its match under its title: it grows to fit both lines. */
  twoLines?: boolean;
  ref?: React.Ref<HTMLDivElement>;
};

/**
 * One row of the palette: 40px, the meta role, with large corners; the row cmdk has picked takes
 * the control wash and the bright text.
 */
function CommandPaletteItem({ className, twoLines, ref, ...props }: CommandPaletteItemProps) {
  return (
    <CommandPrimitive.Item
      ref={ref}
      className={cn(
        "flex cursor-default items-center gap-2.5 rounded-lg px-3",
        "text-meta leading-(--text-body--line-height) text-cream",
        twoLines ? "min-h-13 py-2" : "h-10",
        "data-[selected=true]:bg-control-hover data-[selected=true]:text-cream-bright",
        className,
      )}
      {...props}
    />
  );
}

/** The part of a row's text that matches what was typed: a faint wash in the bright text. */
function CommandPaletteMatch({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <mark
      className={cn(
        "rounded-sm bg-[color-mix(in_srgb,var(--color-cream)_14%,transparent)] text-cream-bright",
        className,
      )}
      {...props}
    />
  );
}

export {
  CommandPaletteInput,
  CommandPaletteItem,
  CommandPaletteList,
  CommandPaletteMatch,
  CommandPaletteTab,
};
export type { CommandPaletteItemProps };
