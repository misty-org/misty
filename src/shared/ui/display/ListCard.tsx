import * as React from "react";
import { cn } from "../classNames";

/**
 * A short list of like rows on one bordered card, split by hairlines, such as the engines to set
 * up on first run. The rows are its `li` children. `className` is for layout.
 *
 * ```tsx
 * <ListCard aria-label="Engines">{engines.map((engine) => <EngineSetupRow … />)}</ListCard>
 * ```
 */
export const ListCard = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...props }, ref) => (
    <ul
      ref={ref}
      data-slot="list-card"
      className={cn(
        "divide-y divide-charcoal-border overflow-hidden rounded-xl border border-charcoal-border",
        "bg-charcoal-card",
        className,
      )}
      {...props}
    />
  ),
);
ListCard.displayName = "ListCard";
