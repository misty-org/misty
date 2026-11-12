import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../classNames";

// A badge is a label, not a control, so it has no hover or focus look of its own.
const badgeVariants = cva(
  [
    "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden",
    "whitespace-nowrap rounded-sm border border-transparent px-1.5 text-caption font-medium",
    "[&>svg]:pointer-events-none [&>svg]:size-3",
  ],
  {
    variants: {
      variant: {
        default: "bg-charcoal-active text-cream-bright",
        secondary: "bg-charcoal-card text-cream",
        outline: "border-charcoal-border text-cream",
        /** A count over an icon or beside a filter: a small round bubble. */
        count: "h-4 min-w-4 rounded-full bg-charcoal-active px-1 text-micro text-cream-bright",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean };

function Badge({ className, variant = "default", asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge };
