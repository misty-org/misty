import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

function watchMotion(notify: () => void): () => void {
  const media = window.matchMedia?.(query);
  media?.addEventListener("change", notify);
  return () => media?.removeEventListener("change", notify);
}

/** Whether the person asked their computer for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    watchMotion,
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

function watchHidden(notify: () => void): () => void {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}

/** Whether the page is out of sight, in which case there is nothing to draw. */
export function usePageHidden(): boolean {
  return useSyncExternalStore(
    watchHidden,
    () => document.hidden,
    () => false,
  );
}
