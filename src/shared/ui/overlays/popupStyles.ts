import * as React from "react";
import { cn } from "../classNames";
/**
 * One popup language for every dropdown, context menu, select, command list and popover.
 * Primitives compose these; call sites should only set width/height/layout,
 * never surface color, border, radius, shadow, or type size.
 */

/**
 * Card, edge, and shadow. The global popup rule in styles.css turns the ring into a real border
 * and clips contents to its rounded edge, so call sites need no `overflow-hidden` for corners.
 */
export const popupSurfaceClass =
  "rounded-lg bg-charcoal-card text-cream shadow-lg ring-1 ring-cream/10 outline-none";

/**
 * Fade and a short slide away from the anchor, from literal keyframes in styles.css.
 * Never a scale: scaled text wiggles while it animates in the desktop shell.
 */
export const popupMotionClass = "misty-popup-motion";

/** Padding and row rhythm shared by every list of menu rows. The one column may shrink to the
 * menu's width: a fading label doesn't wrap, so an `auto` column would grow to fit the
 * longest one and push every row's right side (shortcuts, checkmarks) out of view. */
export const menuListClass = "grid grid-cols-[minmax(0,1fr)] gap-1 p-1";

export const menuContentClass = cn(
  "relative layer-menu max-h-[min(24rem,calc(100dvh-2rem))] w-auto min-w-32",
  "overflow-x-hidden overflow-y-auto data-[state=closed]:overflow-hidden",
  menuListClass,
  popupSurfaceClass,
  popupMotionClass,
);

export const popoverContentClass = `layer-popover w-72 p-3 ${popupSurfaceClass} ${popupMotionClass}`;

/**
 * A menu row's shape and type, without its states: 32px, a 16px icon, the label at the control
 * size. Radix menus and cmdk mark state with different attributes, so each adds its own.
 */
export const menuRowClass = cn(
  "relative flex min-h-8 w-full cursor-default select-none items-center",
  "gap-2 rounded-md px-2 py-1.5 text-left text-control text-cream outline-none",
  "transition-colors [&_svg]:pointer-events-none [&_svg]:shrink-0",
  "[&_svg:not([class*='size-'])]:size-4",
  // Danger paints the label and its icon; the highlight stays the neutral wash.
  "data-[variant=danger]:text-danger",
);

/** A menu row. Also used for plain buttons inside popovers that act as menus. */
export const menuItemClass = cn(
  menuRowClass,
  "hover:bg-charcoal-hover focus:bg-charcoal-hover",
  "focus-visible:bg-charcoal-hover data-highlighted:bg-charcoal-hover",
  "data-[state=open]:bg-charcoal-hover aria-pressed:bg-charcoal-hover",
  "aria-pressed:text-cream-bright disabled:pointer-events-none",
  "disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50",
);

/**
 * A disabled row that explains itself keeps its pointer events, so hovering it can show why.
 * Radix still refuses to select it.
 */
export const menuItemExplainedClass = "data-disabled:pointer-events-auto";

/** A row with a checkmark pinned to the right edge. */
export const menuIndicatorItemClass = `${menuItemClass} pr-8`;
export const menuIndicatorClass =
  "pointer-events-none absolute right-2 flex size-4 items-center justify-center";

/** The leading 16px icon of every row. */
export const menuIconClass = "size-4 shrink-0";
/** A row's label (an OverflowFadeText): it takes the row's free width and fades at its end. */
export const menuLabelTextClass = "min-w-0 flex-1";

export const menuLabelClass = "px-2 py-1 text-meta font-medium text-cream-muted";
export const menuSeparatorClass = "-mx-1 h-px bg-charcoal-border";
export const menuShortcutClass = "ml-auto shrink-0 pl-2 text-meta tracking-widest text-cream-muted";

/** Standard menu widths, so menus across features line up. */
export type MenuWidth = "sm" | "md" | "lg" | "xl";
export const menuWidthClass: Record<MenuWidth, string> = {
  sm: "w-48",
  md: "w-56",
  lg: "w-64",
  xl: "w-72",
};

/**
 * Which kind of menu the rows are inside. DropdownMenuContent and ContextMenuContent set it, so
 * one tree of MenuItems renders as dropdown rows or right-click rows without knowing which.
 */
export type MenuKind = "dropdown" | "context";
export const MenuKindContext = React.createContext<MenuKind>("dropdown");
export const useMenuKind = () => React.useContext(MenuKindContext);
