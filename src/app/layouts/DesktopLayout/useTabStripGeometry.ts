import { useLayoutEffect, type RefObject } from "react";

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
