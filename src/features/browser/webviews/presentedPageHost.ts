import { useLayoutEffect } from "react";

const presentedHosts = new Set<string>();

/**
 * Marks the root while any mounted page host has its page on screen, which turns the window's
 * transparent path on (`theme.css`). It changes in the same commit as the host's own attribute.
 */
export function usePresentedPageHost(pageKey: string, presented: boolean): void {
  useLayoutEffect(() => {
    if (!presented) return;
    presentedHosts.add(pageKey);
    document.documentElement.toggleAttribute("data-browser-page-presented", true);
    return () => {
      presentedHosts.delete(pageKey);
      document.documentElement.toggleAttribute(
        "data-browser-page-presented",
        presentedHosts.size > 0,
      );
    };
  }, [pageKey, presented]);
}
