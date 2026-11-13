import * as ProgressPrimitive from "@radix-ui/react-progress";
import * as React from "react";

import { cn } from "../classNames";

/**
 * How far something has got. `default` sits on the page; `media` is a thin light bar for over a
 * picture or a video, where the page's dark fill on a dark track would disappear.
 */
export type ProgressVariant = "default" | "media";

const trackClass: Record<ProgressVariant, string> = {
  default: "h-2 rounded-full bg-charcoal-card",
  media: "h-0.5 bg-white/20",
};
const indicatorClass: Record<ProgressVariant, string> = {
  default: "bg-charcoal-active",
  media: "bg-cream",
};

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { variant?: ProgressVariant }
>(({ className, value, variant = "default", ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    value={value}
    data-slot="progress"
    data-variant={variant}
    className={cn("relative w-full overflow-hidden", trackClass[variant], className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn("h-full w-full flex-1 transition-all", indicatorClass[variant])}
      style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

/**
 * How full something is (an engine's context window), as a thin bar under the row that names it.
 * Its color is what it means: neutral while there is room, amber from `high`, red from `full`.
 * `share` runs from 0 to 1; even an empty meter shows a sliver, so it reads as a meter.
 *
 * ```tsx
 * <Meter label="Context used" share={0.42} className="mt-1 mb-2" />
 * ```
 */
function Meter({
  label,
  share,
  high = 0.7,
  full = 0.9,
  className,
}: {
  label: string;
  share: number;
  /** Where it turns amber. */
  high?: number;
  /** Where it turns red. */
  full?: number;
  /** Layout only. */
  className?: string;
}) {
  const level = share >= full ? "full" : share >= high ? "high" : undefined;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      data-slot="meter"
      data-level={level}
      className={cn("h-1 overflow-hidden rounded-full bg-row-active", className)}
    >
      <span
        className={cn(
          "block h-full rounded-[inherit]",
          level === "full"
            ? "bg-[var(--tone-failed)]"
            : level === "high"
              ? "bg-[var(--tone-waiting)]"
              : "bg-cream-muted",
        )}
        style={{ width: `${Math.max(2, share * 100)}%` }}
      />
    </div>
  );
}

export { Meter, Progress };
