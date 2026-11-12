import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../classNames";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** The shortcut as it reads, such as "⌘N", "⇧⌘T" or "Ctrl+Alt". One cap holds the whole chord. */
  children: string;
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
export function Kbd({ children, className, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      {...props}
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm border",
        "border-charcoal-border px-1 font-sans text-caption font-normal tracking-wide",
        "whitespace-nowrap text-cream-muted",
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
