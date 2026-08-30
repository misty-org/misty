import { useEffect, useState } from "react";

/** How wide the navigator draws when it is on screen. */
export type NavigatorWidth = "full";
/** Whether the navigator holds its column or slides away until the edge is hovered. */
export type NavigatorVisibility = "sticky" | "hidden";

export interface NavigatorLayout {
  width: NavigatorWidth;
  visibility: NavigatorVisibility;
}

export const navigatorLayoutStorageKey = "misty:global-navigator-layout:v3";
export const navigatorModeStorageKey = "misty:global-navigator-mode:v2";
export const legacyNavigatorCollapsedStorageKey = "misty:global-navigator-collapsed:v1";

export const navigatorWidths: Record<NavigatorWidth | "hidden", number> = {
  full: 264,
  hidden: 0,
};

export function readNavigatorLayout(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): NavigatorLayout {
  const saved = storage.getItem(navigatorLayoutStorageKey);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as Partial<NavigatorLayout>;
      return {
        width: "full",
        visibility: parsed.visibility === "hidden" ? "hidden" : "sticky",
      };
    } catch {
      // A corrupt entry falls through to the older keys below.
    }
  }
  const mode = storage.getItem(navigatorModeStorageKey);
  if (mode === "hidden") return { width: "full", visibility: "hidden" };
  return { width: "full", visibility: "sticky" };
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
  window.dispatchEvent(
    new CustomEvent(navigatorLayoutChangedEvent, {
      detail: layout,
    }),
  );
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
