import { useSyncExternalStore } from "react";

/**
 * How often a clock moves: on the minute for times a person reads ("3m", "yesterday", "due in 2
 * days"), every second for a running counter ("0:42").
 */
export type ClockStep = "minute" | "second";

const stepMs: Record<ClockStep, number> = { minute: 60_000, second: 1_000 };

interface Clock {
  now: number;
  listeners: Set<() => void>;
  timer: number | undefined;
}

const clocks: Record<ClockStep, Clock> = {
  minute: { now: Date.now(), listeners: new Set(), timer: undefined },
  second: { now: Date.now(), listeners: new Set(), timer: undefined },
};

function tell(clock: Clock) {
  clock.now = Date.now();
  for (const listener of clock.listeners) listener();
}

/** The next move lands just past the step's boundary, so "3m" turns to "4m" when it should. */
function schedule(step: ClockStep) {
  const clock = clocks[step];
  if (clock.timer !== undefined) window.clearTimeout(clock.timer);
  clock.timer = undefined;
  if (!clock.listeners.size || document.visibilityState === "hidden") return;
  const size = stepMs[step];
  clock.timer = window.setTimeout(
    () => {
      clock.timer = undefined;
      tell(clock);
      schedule(step);
    },
    size - (Date.now() % size) + 20,
  );
}

/** A hidden window's clocks stop; it catches up the moment it is seen or focused again. */
function wake() {
  for (const step of Object.keys(clocks) as ClockStep[]) {
    const clock = clocks[step];
    if (!clock.listeners.size) continue;
    tell(clock);
    schedule(step);
  }
}

let watching = false;
function watchWindow() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
}

function subscribe(step: ClockStep, listener: () => void) {
  const clock = clocks[step];
  watchWindow();
  if (!clock.listeners.size) clock.now = Date.now();
  clock.listeners.add(listener);
  if (clock.timer === undefined) schedule(step);
  return () => {
    clock.listeners.delete(listener);
    if (!clock.listeners.size && clock.timer !== undefined) {
      window.clearTimeout(clock.timer);
      clock.timer = undefined;
    }
  };
}

const subscribers: Record<ClockStep, (listener: () => void) => () => void> = {
  minute: (listener) => subscribe("minute", listener),
  second: (listener) => subscribe("second", listener),
};

/**
 * The current time, for anything shown relative to it. React re-renders on state, and time passing
 * is no state change, so a "3m" computed from `Date.now()` during render stays "3m" until
 * something else happens to re-render it. This is that missing event: one local clock for the
 * whole app (never a request to anything), moving on each step while the window is visible and
 * catching up as soon as it is seen again. Every component on the same step re-renders together.
 *
 * ```tsx
 * const now = useNow();
 * return <span>{shortAgo(chat.updatedAt, now)}</span>;
 * ```
 */
export function useNow(step: ClockStep = "minute"): number {
  return useSyncExternalStore(
    subscribers[step],
    () => clocks[step].now,
    () => clocks[step].now,
  );
}
