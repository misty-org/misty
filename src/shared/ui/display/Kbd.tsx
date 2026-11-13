import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../classNames";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** The shortcut as it reads, such as "⌘N", "⇧⌘T" or "Ctrl+Alt". One cap holds the whole chord. */
  children: string;
  /**
   * The key a floating bar names as its own control ("E Talk to Ada" over the Studio): a stronger
   * edge and a bolder micro label in the surrounding color, instead of a muted hint.
   */
  strong?: boolean;
  /**
   * `micro` for a hint among caption-size text or at the end of a row (a palette's foot of key
   * hints, "Search ⌘K" in the sidebar); `caption` otherwise.
   */
  size?: "caption" | "micro";
  /** `false` drops the hairline, for a hint at the end of a row that has no frame of its own. */
  outline?: boolean;
}

/**
 * A keycap for a shortcut hint: a hairline outline around the keys in the caption role, muted,
 * with no fill, so it reads as a hint and never as a dark button. Tooltips and menu rows draw
 * their `shortcut` with it; use it directly only for a hint in running text ("Press ⌘K to …").
 * Shortcuts are written in the sans font like any other label, never monospace.
 *
 * ```tsx
 * <Text size="meta" tone="muted">Press <Kbd>⌘K</Kbd> to search</Text>
 * ```
 */
export function Kbd({
  children,
  strong = false,
  size = "caption",
  outline = true,
  className,
  ...props
}: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      data-strong={strong || undefined}
      {...props}
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm border",
        "border-charcoal-border px-1 font-sans text-caption font-normal tracking-wide",
        "whitespace-nowrap text-cream-muted",
        size === "micro" && "text-micro tracking-normal",
        !outline && "border-transparent",
        strong &&
          "rounded-md border-charcoal-border-strong px-1.5 text-micro font-semibold tracking-normal text-inherit",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * What a shortcut slot (a menu row's, a tooltip's) draws: a string becomes a Kbd, and an element
 * such as `<ShortcutText />`, which draws its own Kbd, is kept as it is.
 */
export function asKbd(shortcut: ReactNode): ReactNode {
  return typeof shortcut === "string" && shortcut ? <Kbd>{shortcut}</Kbd> : shortcut;
}
