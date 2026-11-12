import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioState } from "./useStudioAgents";

/** How long an agent stays at its desk after its run stops, in case another follows at once. */
export const LINGER_MS = 10_000;

export interface Shown {
  state: StudioState;
  doing: string;
  doingCode: string;
}

interface Memory {
  /** When it was last seen working, and what it was doing then. */
  at: number;
  doing: string;
  doingCode: string;
}

/**
 * What the room shows for an agent: what its runs report, except that one that just stopped
 * working is shown at work a little longer. Runs report in bursts, a run passes through a moment
 * of no state as it ends and the next one starts, and a figure that got up and sat back down each
 * time would be walking for nothing. Needing the person always shows at once.
 */
export function steadyState(
  reported: Shown,
  memory: Memory | undefined,
  now: number,
): { shown: Shown; memory: Memory | undefined } {
  if (reported.state !== "resting") {
    const working = reported.state === "working";
    return {
      shown: reported,
      memory: working
        ? { at: now, doing: reported.doing, doingCode: reported.doingCode }
        : memory && { ...memory, at: now },
    };
  }
  if (memory && now - memory.at < LINGER_MS)
    return {
      shown: { state: "working", doing: memory.doing, doingCode: memory.doingCode },
      memory,
    };
  return { shown: reported, memory: undefined };
}

/** `steadyState` for every agent in view, re-checked once the oldest linger runs out. */
export function useSteadyStates<T extends Shown & { id: string }>(items: T[]): T[] {
  const memory = useRef(new Map<string, Memory>());
  const [clock, setClock] = useState(0);
  const shown = useMemo(() => {
    void clock;
    const now = Date.now();
    return items.map((item) => {
      const next = steadyState(item, memory.current.get(item.id), now);
      if (next.memory) memory.current.set(item.id, next.memory);
      else memory.current.delete(item.id);
      return next.shown === item ? item : { ...item, ...next.shown };
    });
  }, [items, clock]);
  useEffect(() => {
    const now = Date.now();
    let soonest = Infinity;
    shown.forEach((item, index) => {
      const lingering = item.state === "working" && items[index]?.state === "resting";
      const since = memory.current.get(item.id)?.at;
      if (lingering && since !== undefined) soonest = Math.min(soonest, since + LINGER_MS - now);
    });
    if (soonest === Infinity) return;
    const timer = window.setTimeout(() => setClock((known) => known + 1), Math.max(50, soonest));
    return () => window.clearTimeout(timer);
  }, [items, shown]);
  return shown;
}
