import { useState, type FocusEvent } from "react";

/**
 * Open while the pointer is over the element or the keyboard is in it, for a panel that rests
 * small and unfolds when it's reached for. A click's focus doesn't hold it open, so it folds
 * again once the pointer leaves.
 *
 * ```tsx
 * const { open, handlers } = useHoverOpen();
 * <Surface {...handlers}><Card compact={!open} /></Surface>
 * ```
 */
export function useHoverOpen() {
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  return {
    open: pointed || focused,
    handlers: {
      onPointerEnter: () => setPointed(true),
      onPointerLeave: () => setPointed(false),
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (event.target.matches(":focus-visible")) setFocused(true);
      },
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      },
    },
  };
}
