export type NavigatorMode = "full" | "icons" | "hidden";
export type VisibleNavigatorMode = Exclude<NavigatorMode, "hidden">;

export const navigatorModeStorageKey = "misty:global-navigator-mode:v2";
export const legacyNavigatorCollapsedStorageKey = "misty:global-navigator-collapsed:v1";

export const navigatorWidths: Record<NavigatorMode, number> = {
  full: 232,
  icons: 72,
  hidden: 0,
};

export function readNavigatorMode(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): NavigatorMode {
  const saved = storage.getItem(navigatorModeStorageKey);
  if (saved === "full" || saved === "icons" || saved === "hidden") return saved;
  return storage.getItem(legacyNavigatorCollapsedStorageKey) === "true" ? "icons" : "full";
}

export function writeNavigatorMode(
  mode: NavigatorMode,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(navigatorModeStorageKey, mode);
}
