import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "./utils";

const navIslandVariants = cva(
  "inline-flex max-w-full items-center shrink-0 border border-charcoal-border bg-charcoal-card overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  {
    variants: {
      variant: {
        default: "border-charcoal-border bg-charcoal-card",
        subtle: "border-charcoal-border/60 bg-charcoal-card/80",
        ghost: "border-transparent bg-transparent",
      },
      size: {
        default: "p-0.5 gap-0.5 rounded-lg",
        sm: "p-[1px] gap-[1px] rounded-md",
        md: "p-1 gap-1 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const navIslandItemVariants = cva(
  "group/nav-island-item inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent font-medium whitespace-nowrap outline-none transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-muted disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "text-cream-muted hover:bg-charcoal-hover/40 hover:text-cream aria-[current=page]:bg-charcoal-hover aria-[current=page]:text-cream-bright data-[active=true]:bg-charcoal-hover data-[active=true]:text-cream-bright",
      },
      active: {
        true: "!bg-charcoal-hover !text-cream-bright font-medium",
        false: "",
      },
      size: {
        default: "h-6 px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-5 px-1.5 text-[11px] [&_svg:not([class*='size-'])]:size-3",
        md: "h-7 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface NavIslandProps
  extends React.HTMLAttributes<HTMLElement>, VariantProps<typeof navIslandVariants> {
  asChild?: boolean;
}

export interface NavIslandItemProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof navIslandItemVariants> {
  asChild?: boolean;
  active?: boolean;
}

const NavIsland = React.forwardRef<HTMLElement, NavIslandProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "nav";
    return (
      <Comp
        ref={ref}
        data-slot="nav-island"
        className={cn(navIslandVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
NavIsland.displayName = "NavIsland";

const NavIslandItem = React.forwardRef<HTMLButtonElement, NavIslandItemProps>(
  ({ className, variant, size, active, asChild = false, type = "button", ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const isCurrent = Boolean(
      active || props["aria-current"] === "page" || props["aria-current"] === true,
    );
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        data-slot="nav-island-item"
        data-active={isCurrent ? "true" : undefined}
        aria-current={isCurrent ? "page" : undefined}
        className={cn(navIslandItemVariants({ variant, size, active: isCurrent, className }))}
        {...props}
      />
    );
  },
);
NavIslandItem.displayName = "NavIslandItem";

export {
  NavIsland,
  NavIslandItem,
  navIslandVariants,
  navIslandItemVariants,
  NavIsland as IslandNav,
  NavIslandItem as IslandNavItem,
};
