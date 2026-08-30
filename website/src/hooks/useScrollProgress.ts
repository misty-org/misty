import { useEffect, useRef, useState } from "react";

/**
 * How far the viewport has travelled through a tall element, as 0…1.
 *
 * Pair with a `position: sticky` child: the child pins while the parent
 * scrolls past, and the returned progress says which beat of the story should
 * be showing. `useReveal` answers "is it on screen yet"; this answers "how far
 * in are we", which is the difference between a fade-in and a demo.
 *
 * Returns 0 under `prefers-reduced-motion`, where the section renders as a
 * plain stacked list and progress has nothing to drive.
 */
export function useScrollProgress<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) return;

    let frame = 0;

    const measure = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      // The sticky child is one viewport tall, so that much of the track is
      // spent holding the last beat rather than travelling between beats.
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) {
        setProgress(0);
        return;
      }
      setProgress(Math.min(1, Math.max(0, -rect.top / travel)));
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    // Capture scroll events from nested page scrollers as well as the window.
    // This keeps the pinned story responsive if its surrounding layout changes
    // which element owns vertical scrolling.
    document.addEventListener("scroll", onScroll, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return { ref, progress };
}

/**
 * Where a 0…1 progress value lands across `count` beats.
 *
 * `index` is the active beat; `within` is how far through that beat we are,
 * which is what lets a progress bar fill continuously instead of stepping.
 */
export function beatPosition(progress: number, count: number) {
  const raw = progress * count;
  const index = Math.min(count - 1, Math.floor(raw));
  return { index, within: Math.min(1, Math.max(0, raw - index)) };
}

/** Cubic ease-out, for scroll-driven transforms that should settle rather than ramp. */
export function easeOut(t: number) {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}
