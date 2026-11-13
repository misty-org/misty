import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../classNames";
import type { ItemTone } from "../icons/itemTones";

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

// Literal class names so Tailwind picks them up: the tone's text over a faint fill of itself.
const badgeToneClass: Record<ItemTone, string> = {
  blue: "bg-tone-blue/15 text-tone-blue",
  red: "bg-tone-red/15 text-tone-red",
  green: "bg-tone-green/15 text-tone-green",
  orange: "bg-tone-orange/15 text-tone-orange",
  violet: "bg-tone-violet/15 text-tone-violet",
  pink: "bg-tone-pink/15 text-tone-pink",
  amber: "bg-tone-amber/15 text-tone-amber",
  teal: "bg-tone-teal/15 text-tone-teal",
  sand: "bg-tone-sand/15 text-tone-sand",
};

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
    /**
     * A colored mark whose color says what it is, such as a pull request's state (merged in
     * violet, closed in red): the tone's text over a faint fill of it, in place of the variant's.
     */
    tone?: ItemTone;
  };

function Badge({ className, variant = "default", asChild = false, tone, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      data-tone={tone}
      className={cn(badgeVariants({ variant }), tone && badgeToneClass[tone], className)}
      {...props}
    />
  );
}

export { Badge };
