import { useLayoutEffect, useRef, useState } from "react";

const MIN_SCALE = 0.55;

/**
 * Shrinks a panel until it fits its scroll container's height, so a small window never
 * cuts it off. Scales with CSS zoom (it reflows, unlike a transform) and re-fits whenever
 * either box resizes, e.g. when an error message appears.
 */
export function useFitToHeight<T extends HTMLElement, C extends HTMLElement>() {
  const panelRef = useRef<T>(null);
  const containerRef = useRef<C>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const container = containerRef.current;
    if (!panel || !container) return;
    const fit = () => {
      const style = getComputedStyle(container);
      const room =
        container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      // Measure at full size (synchronously, so nothing paints), then restore the current zoom.
      const applied = panel.style.zoom;
      panel.style.zoom = "1";
      const natural = panel.getBoundingClientRect().height;
      panel.style.zoom = applied;
      const next = Math.max(MIN_SCALE, Math.min(1, room / natural));
      if (Math.abs(next - scaleRef.current) < 0.005) return;
      scaleRef.current = next;
      setScale(next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  return { panelRef, containerRef, scale };
}
