import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Fades a tab list's edges while more tabs are scrolled out of view (sideways, or up and down). */
export function useTabStripFade(
  listRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  count: number,
  axis: "x" | "y" = "x",
) {
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !enabled) return;
    const updateFade = () => {
      const y = axis === "y";
      const offset = y ? list.scrollTop : list.scrollLeft;
      const rest = y
        ? list.scrollHeight - list.clientHeight - list.scrollTop
        : list.scrollWidth - list.clientWidth - list.scrollLeft;
      const size = y ? "28px" : "16px";
      list.style.setProperty("--tab-fade-start", offset > 1 ? size : "0px");
      list.style.setProperty("--tab-fade-end", rest > 1 ? size : "0px");
    };
    updateFade();
    const observer = new ResizeObserver(updateFade);
    observer.observe(list);
    Array.from(list.children).forEach((child) => observer.observe(child));
    list.addEventListener("scroll", updateFade, { passive: true });
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", updateFade);
    };
  }, [listRef, enabled, count, axis]);
}

/** The rendered size of a dock pane, so split controls only offer splits that fit. */
export function usePaneBounds(paneId: string, root: unknown) {
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const paneSelector = typeof CSS !== "undefined" && CSS?.escape ? CSS.escape(paneId) : paneId;
    const element = document.querySelector<HTMLElement>(`[data-workspace-pane="${paneSelector}"]`);
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setBounds({ width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [paneId, root]);
  return bounds;
}
