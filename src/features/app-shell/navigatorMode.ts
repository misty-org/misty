import { useEffect, useState } from "react";

/** Navigation is always a thin icon rail, either pinned or revealed at the edge. */
export interface NavigatorLayout {
  autoHide: boolean;
}

export const navigatorLayoutStorageKey = "misty:global-navigator-layout:v6";
export const navigatorRailWidth = 66;

export function readNavigatorLayout(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): NavigatorLayout {
  try {
    const saved = storage.getItem(navigatorLayoutStorageKey);
    if (saved) return { autoHide: JSON.parse(saved)?.autoHide === true };
  } catch {
    // Corrupt or retired width settings return to the visible icon rail.
  }
  return { autoHide: false };
}

export function writeNavigatorLayout(
  layout: NavigatorLayout,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(navigatorLayoutStorageKey, JSON.stringify(layout));
}

export const navigatorLayoutChangedEvent = "misty:navigator-layout-changed";
export function publishNavigatorLayout(layout: NavigatorLayout): void {
  writeNavigatorLayout(layout);
  window.dispatchEvent(new CustomEvent(navigatorLayoutChangedEvent, { detail: layout }));
}

export function useNavigatorLayoutValue(): NavigatorLayout {
  const [layout, setLayout] = useState<NavigatorLayout>(() => readNavigatorLayout());
  useEffect(() => {
    const sync = () => setLayout(readNavigatorLayout());
    window.addEventListener(navigatorLayoutChangedEvent, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(navigatorLayoutChangedEvent, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return layout;
}
