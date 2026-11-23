import { useState, type FocusEvent } from "react";

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
