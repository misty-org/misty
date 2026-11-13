import * as React from "react";

import { cn } from "../classNames";

/**
 * A bordered surface for the collection grid and a few settings and invitation panels. Panes
 * elsewhere are flat, split by hairlines, and never cards.
 */
const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, size = "default", ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-6 overflow-hidden rounded-xl border border-charcoal-border",
        "bg-charcoal-card py-6 text-body text-cream shadow-none data-[size=sm]:gap-4 data-[size=sm]:py-4",
        "has-[>img:first-child]:pt-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export { Card };

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  size?: "default" | "sm";
};
