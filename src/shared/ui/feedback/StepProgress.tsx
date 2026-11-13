import { cn } from "../classNames";

export type StepProgressProps = {
  /** How many steps there are. */
  steps: number;
  /** The step shown, from 0. It and the ones before it are filled. */
  current: number;
  /** What the steps are of, for screen readers, such as "Setup steps". */
  label: string;
  /** Layout only. */
  className?: string;
};

/**
 * Where a person is in a few steps: one bar per step, filled up to the current one. Each bar is
 * announced as "Step 2 of 3", and the current one as the current step.
 *
 * ```tsx
 * <StepProgress label="Setup steps" steps={3} current={index} />
 * ```
 */
export function StepProgress({ steps, current, label, className }: StepProgressProps) {
  return (
    <ol
      aria-label={label}
      data-slot="step-progress"
      className={cn("flex flex-1 items-center gap-1.5", className)}
    >
      {Array.from({ length: steps }, (_, position) => (
        <li
          key={position}
          aria-current={position === current ? "step" : undefined}
          aria-label={`Step ${position + 1} of ${steps}`}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors",
            position <= current ? "bg-cream-bright" : "bg-charcoal-active",
          )}
        />
      ))}
    </ol>
  );
}
