import { cn } from "../classNames";

/** How a tick stands among its neighbours: at rest, nearest the pointer, or the place shown now. */
export type RailTickState = "rest" | "near" | "current";

export type RailTickProps = {
  state?: RailTickState;
  /** Its length in pixels; ticks grow toward the pointer, so the caller works it out. */
  length: number;
  /** Layout only: placement in the rail. */
  className?: string;
};

const stateClass: Record<RailTickState, string> = {
  rest: "bg-charcoal-border",
  near: "bg-cream-muted",
  current: "bg-cream",
};

/**
 * A short line marking one place along a rail (one message in a long chat): faint at rest,
 * brighter nearest the pointer, in the text color for the place on screen now. Its length and
 * color ease as they change. It is a picture; the control holding it names the place.
 *
 * ```tsx
 * <RailTick state={active ? "current" : "rest"} length={13} />
 * ```
 */
export function RailTick({ state = "rest", length, className }: RailTickProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="rail-tick"
      data-state={state}
      style={{ width: length }}
      className={cn(
        "block h-0.5 rounded-full transition-[width,background-color] duration-150 ease-out",
        "motion-reduce:transition-none",
        stateClass[state],
        className,
      )}
    />
  );
}
