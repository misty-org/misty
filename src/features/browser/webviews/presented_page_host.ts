import { useLayoutEffect } from "react";

const presentedHosts = new Set<string>();

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
