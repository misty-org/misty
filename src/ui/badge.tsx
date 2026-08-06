import type { BadgeProps } from "@/models/types/ui/badge";
export type { BadgeProps } from "@/models/types/ui/badge";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/ui";

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border border-transparent px-2 py-0.5 text-xs font-medium transition-all focus-visible:border-charcoal-active focus-visible:ring-[3px] focus-visible:ring-charcoal-active/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-charcoal-active text-cream-bright hover:bg-charcoal-active",
        secondary: "bg-charcoal-card text-cream hover:bg-charcoal-card",
        destructive: "bg-charcoal-active text-cream-bright hover:bg-charcoal-active",
        outline: "border-charcoal-border text-cream hover:bg-charcoal-card",
        ghost: "text-cream-muted hover:bg-charcoal-card hover:text-cream",
        link: "text-cream-bright underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

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

export { Badge, badgeVariants };
