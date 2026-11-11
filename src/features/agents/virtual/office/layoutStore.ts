import { useCallback, useState } from "react";
import { defaultLayout, parseLayout, serializeLayout, type OfficeLayout } from "./layout";

/** The office's arrangement is a convenience of this computer, kept per Space. */
const keyOf = (space: string) => `misty.virtualOffice.layout:${space || "personal"}`;

export function loadLayout(space: string): OfficeLayout {
  try {
    return parseLayout(window.localStorage.getItem(keyOf(space))) ?? defaultLayout();
  } catch {
    return defaultLayout();
  }
}

function saveLayout(space: string, layout: OfficeLayout | null): void {
  try {
    if (layout) window.localStorage.setItem(keyOf(space), serializeLayout(layout));
    else window.localStorage.removeItem(keyOf(space));
  } catch {
    // Without storage the arrangement simply lasts as long as the page does.
  }
}

/** The Space's office layout, saved on this computer every time it changes. */
export function useOfficeLayout(space: string): {
  layout: OfficeLayout;
  change(next: OfficeLayout): void;
  reset(): void;
} {
  const [held, setHeld] = useState(() => ({ space, layout: loadLayout(space) }));
  let current = held;
  if (held.space !== space) {
    current = { space, layout: loadLayout(space) };
    setHeld(current);
  }
  const change = useCallback(
    (next: OfficeLayout) => {
      setHeld({ space, layout: next });
      saveLayout(space, next);
    },
    [space],
  );
  const reset = useCallback(() => {
    setHeld({ space, layout: defaultLayout() });
    saveLayout(space, null);
  }, [space]);
  return { layout: current.layout, change, reset };
}
