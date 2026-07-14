import { cn } from "../utils";
/**
 * One popup language for every dropdown, context menu, select, and popover.
 * Primitives compose these; call sites should only set width/height/layout,
 * never surface color, border, radius, shadow, or type size.
 */

/** Card, edge, and shadow. The global popup rule in styles.css turns the ring into a real border. */
export const popupSurfaceClass =
  "rounded-lg bg-charcoal-card text-cream shadow-lg ring-1 ring-cream/10 outline-none";

export const popupMotionClass = cn(
  "origin-center duration-150 ease-out data-[state=open]:animate-in",
  "data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
  "data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2",
  "data-[side=left]:slide-in-from-right-2",
  "data-[side=right]:slide-in-from-left-2",
  "data-[side=top]:slide-in-from-bottom-2",
);

/** Padding and row rhythm shared by every list of menu rows. */
export const menuListClass = "grid gap-1 p-1";

export const menuContentClass = cn(
  "relative layer-menu max-h-[min(24rem,calc(100dvh-2rem))] w-auto min-w-32",
  "overflow-x-hidden overflow-y-auto data-[state=closed]:overflow-hidden",
  menuListClass,
  popupSurfaceClass,
  popupMotionClass,
);

export const popoverContentClass = `layer-popover w-72 p-3 ${popupSurfaceClass} ${popupMotionClass}`;

/** A menu row. Also used for plain buttons inside popovers that act as menus. */
export const menuItemClass = cn(
  "relative flex min-h-8 w-full cursor-default select-none items-center",
  "gap-2 rounded-md px-2 py-1.5 text-left text-sm text-cream outline-none",
  "transition-colors hover:bg-charcoal-hover focus:bg-charcoal-hover",
  "focus-visible:bg-charcoal-hover data-highlighted:bg-charcoal-hover",
  "data-[state=open]:bg-charcoal-hover aria-pressed:bg-charcoal-hover",
  "aria-pressed:text-cream-bright disabled:pointer-events-none",
  "disabled:opacity-50 data-disabled:pointer-events-none",
  "data-disabled:opacity-50 data-inset:pl-8",
  "data-[variant=destructive]:text-cream-bright [&_svg]:pointer-events-none",
  "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
);

/** A row with a check/dot indicator pinned to the right edge. */
export const menuIndicatorItemClass = `${menuItemClass} pr-8`;
export const menuIndicatorClass =
  "pointer-events-none absolute right-2 flex size-4 items-center justify-center";

export const menuLabelClass = "px-2 py-1 text-xs font-medium text-cream-muted data-inset:pl-8";
export const menuSeparatorClass = "-mx-1 h-px bg-charcoal-border";
export const menuShortcutClass = "ml-auto text-xs tracking-widest text-cream-muted";

/** Standard menu widths, so menus across features line up. */
export type MenuWidth = "sm" | "md" | "lg" | "xl";
export const menuWidthClass: Record<MenuWidth, string> = {
  sm: "w-48",
  md: "w-56",
  lg: "w-64",
  xl: "w-72",
};
