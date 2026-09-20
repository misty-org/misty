import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Lines of sliding text that move as one: the same speed, the same start, the same turnaround.
 * Each line reports how far it has to slide; all of them follow the longest one's rhythm, and a
 * line that gets to its end sooner waits there until the direction changes.
 */
export interface MarqueeGroupState {
  /** When the shared rhythm began, on the document timeline, in milliseconds. */
  epoch: number;
  longest(): number;
  set(id: symbol, distance: number): void;
  subscribe(listener: () => void): () => void;
}

function createGroup(): MarqueeGroupState {
  const distances = new Map<symbol, number>();
  const listeners = new Set<() => void>();
  const group: MarqueeGroupState = {
    epoch: document.timeline?.currentTime ? Number(document.timeline.currentTime) : 0,
    longest: () => Math.max(0, ...distances.values()),
    set(id, distance) {
      if ((distances.get(id) ?? 0) === distance) return;
      if (distance > 0) distances.set(id, distance);
      else distances.delete(id);
      // A change to any line starts every line over together.
      group.epoch = document.timeline?.currentTime ? Number(document.timeline.currentTime) : 0;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return group;
}

const MarqueeGroupContext = createContext<MarqueeGroupState | null>(null);

export function MarqueeGroup({ children }: { children: ReactNode }) {
  const [group] = useState(createGroup);
  return <MarqueeGroupContext.Provider value={group}>{children}</MarqueeGroupContext.Provider>;
}

export const useMarqueeGroup = () => useContext(MarqueeGroupContext);
