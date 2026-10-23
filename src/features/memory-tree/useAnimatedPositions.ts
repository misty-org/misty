import { animate } from "motion";
import { useEffect, useRef, useState } from "react";
import { type Point } from "./layout";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Where a node starts: where it was, else where its nearest known ancestor is. */
function startOf(
  id: string,
  now: ReadonlyMap<string, Point>,
  parentOf: ReadonlyMap<string, string | null>,
  fallback: Point,
): Point {
  for (let at: string | null | undefined = id; at; at = parentOf.get(at)) {
    const found = now.get(at);
    if (found) return found;
  }
  return fallback;
}

/**
 * Glides every node from its current position to a new layout, and fans new nodes out of their
 * parent. Nodes and edges both read these positions, so a curve never lags the node it joins.
 */
export function useAnimatedPositions(
  target: ReadonlyMap<string, Point>,
  parentOf: ReadonlyMap<string, string | null>,
): ReadonlyMap<string, Point> {
  const [current, setCurrent] = useState<ReadonlyMap<string, Point>>(target);
  const latest = useRef(current);

  useEffect(() => {
    if (reducedMotion()) {
      latest.current = target;
      setCurrent(target);
      return;
    }
    const from = new Map<string, Point>();
    for (const [id, to] of target) from.set(id, startOf(id, latest.current, parentOf, to));
    const controls = animate(0, 1, {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (t) => {
        const next = new Map<string, Point>();
        for (const [id, to] of target) {
          const start = from.get(id) ?? to;
          next.set(id, { x: start.x + (to.x - start.x) * t, y: start.y + (to.y - start.y) * t });
        }
        latest.current = next;
        setCurrent(next);
      },
    });
    return () => controls.stop();
  }, [target, parentOf]);

  return current;
}
