import { cn } from "../classNames";

/**
 * How full something is, as a ring at the glyph size: a faint track and an arc that brightens
 * once it passes `high` of the way. With no `value` the track is dashed: the total isn't known.
 * It is a picture; the control holding it says what it measures.
 */
export function RingMeter({
  value,
  high = 0.85,
  className,
}: {
  /** From 0 to 1, or undefined when the total is unknown. */
  value?: number;
  high?: number;
  className?: string;
}) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const fraction = value === undefined ? 0 : Math.min(1, Math.max(0, value));
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      data-slot="ring-meter"
      className={cn("size-4", className)}
    >
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        strokeWidth="2"
        className="stroke-charcoal-border"
        strokeDasharray={value === undefined ? "2 2" : undefined}
      />
      {value !== undefined ? (
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${fraction * circumference} ${circumference}`}
          transform="rotate(-90 8 8)"
          className={fraction > high ? "stroke-cream" : "stroke-cream-muted"}
        />
      ) : null}
    </svg>
  );
}
