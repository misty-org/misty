import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Whether the preview's frame is really drawn. A workspace tab the person switched away from
 * stays mounted with its contents skipped (`content-visibility: hidden`), and its frame still
 * measures as if it were there, so the native page would stay up over whatever tab is showing.
 */
export function useHostInView(host: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const check = () => setInView(element.checkVisibility());
    // Tabs are kept and brought back by marking their layer hidden, which is an attribute change.
    const layers = new MutationObserver(check);
    layers.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "hidden", "inert", "data-page"],
    });
    check();
    return () => layers.disconnect();
  }, [host]);
  return inView;
}
