import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

import { cn } from "./utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-charcoal-active focus-visible:ring-3 focus-visible:ring-charcoal-active/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-charcoal-active aria-invalid:ring-3 aria-invalid:ring-charcoal-active/20 aria-invalid:border-charcoal-active/50 aria-invalid:ring-charcoal-active/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-charcoal-active text-cream-bright hover:bg-[#494949]",
        destructive:
          "border-charcoal-active bg-charcoal-card text-cream-bright hover:bg-charcoal-active focus-visible:border-charcoal-active focus-visible:ring-charcoal-active/40",
        // Unfilled variants brighten on hover rather than growing a background:
        // a button that already carries a fill keeps it and lightens, one that
        // does not stays flat. Anything overriding this should have a reason.
        outline:
          "border-charcoal-border bg-charcoal-bg shadow-none hover:border-charcoal-active hover:text-cream-bright aria-expanded:text-cream-bright",
        secondary:
          "bg-charcoal-card text-cream hover:text-cream-bright aria-expanded:text-cream-bright",
        ghost: "hover:text-cream-bright aria-expanded:text-cream-bright",
        link: "text-cream-bright underline-offset-4 hover:underline",
        pill: "rounded-full border-0 bg-charcoal-hover text-cream hover:bg-charcoal-card focus-visible:bg-charcoal-card focus-visible:ring-1 focus-visible:ring-cream-muted active:bg-charcoal-bg data-[state=open]:bg-charcoal-card",
        "pill-subtle":
          "rounded-full border-charcoal-border bg-transparent text-cream-muted hover:border-charcoal-active hover:text-cream-bright",
        "nav-action":
          "rounded-md border-0 bg-transparent p-0 text-cream-muted hover:bg-charcoal-card hover:text-cream-bright focus-visible:ring-2 focus-visible:ring-cream-muted disabled:cursor-wait",
      },
      size: {
        default:
          "h-9 gap-1.5 px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-md px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-10 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-9",
        "icon-xs":
          "size-6 rounded-md in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-md in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-10",
        pill: "h-[22px] min-w-0 max-w-[50%] px-2 text-[13px] gap-1 [&_svg]:!size-3.5 [&_img]:!size-3.5",
      },
      reveal: {
        always: "",
        "row-hover":
          "opacity-0 pointer-events-none group-hover/app-row:opacity-100 group-hover/app-row:pointer-events-auto group-focus-within/app-row:opacity-100 group-focus-within/app-row:pointer-events-auto data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto",
        "tree-hover":
          "!opacity-0 group-hover/tree-row:!opacity-100 group-focus-within/tree-row:!opacity-100 [@media(hover:none)]:!opacity-100",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      reveal: "always",
    },
  },
);

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, reveal, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        data-slot="button"
        data-variant={variant ?? "default"}
        data-size={size ?? "default"}
        data-reveal={reveal ?? "always"}
        className={cn(buttonVariants({ variant, size, reveal, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
