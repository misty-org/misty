import { cn } from "../classNames";

/**
 * A small dot pinned to the corner of an icon or avatar, marking that something about it needs
 * a look (out of sync, unread). A ring in the surface's own color cuts it out of the icon under
 * it. The parent is the positioning box (`relative`); the dot carries no label of its own, so the
 * control it marks says what it means.
 */
export function IndicatorDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="indicator-dot"
      className={cn(
        "pointer-events-none absolute right-0.5 bottom-0.5 size-1.5 rounded-full",
        "bg-cream-bright ring-2 ring-charcoal-card",
        className,
      )}
    />
  );
}
