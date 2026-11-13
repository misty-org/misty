import { cn } from "../classNames";

/** Where a step of some work is: not started, being worked on, finished, or stopped by a failure. */
export type StepDotState = "pending" | "working" | "done" | "failed";

export type StepDotProps = {
  state: StepDotState;
  /** `sm` (6px) beside a line of text, `md` (10px, the default) leading a row in a list of steps. */
  size?: "sm" | "md";
  /** Layout only: margins or placement. */
  className?: string;
};

const stateClass: Record<StepDotState, string> = {
  pending: "border border-dashed border-cream-muted",
  working:
    "bg-[var(--tone-working)] animate-[misty-breathe_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
  done: "bg-cream-muted",
  failed: "bg-[var(--tone-failed)]",
};

/**
 * A small round mark for a step's state in a quiet list of them (a run's checklist, its
 * sub-agents): a dashed ring before it starts, a breathing dot in the working color while it
 * runs, a muted dot once done and a red one when it failed. It is a picture; the row beside it
 * says what the step is.
 *
 * ```tsx
 * <StepDot state={item.status === "done" ? "done" : "pending"} />
 * ```
 */
export function StepDot({ state, size = "md", className }: StepDotProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="step-dot"
      data-state={state}
      className={cn(
        "shrink-0 rounded-full",
        size === "sm" ? "size-1.5" : "size-2.5",
        stateClass[state],
        className,
      )}
    />
  );
}
