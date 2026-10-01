import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

import { cn } from "../utils";

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center rounded-md border",
    "border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap",
    "transition-none outline-none select-none",
    "focus-visible:border-charcoal-active focus-visible:ring-3",
    "focus-visible:ring-charcoal-active/50 disabled:pointer-events-none",
    "disabled:opacity-50 aria-invalid:border-charcoal-active",
    "aria-invalid:ring-3 aria-invalid:ring-charcoal-active/20",
    "aria-invalid:border-charcoal-active/50",
    "aria-invalid:ring-charcoal-active/40 [&_svg]:pointer-events-none",
    "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: "bg-charcoal-active text-cream-bright hover:bg-[#494949]",
        destructive:
          "border-charcoal-active bg-charcoal-card text-cream-bright hover:bg-charcoal-active focus-visible:border-charcoal-active focus-visible:ring-charcoal-active/40",
        // Every variant fills on hover and while open/pressed, so interactive
        // controls read the same across the app.
        outline: [
          "border-charcoal-border bg-transparent shadow-none",
          "hover:border-charcoal-active hover:bg-charcoal-hover",
          "hover:text-cream-bright aria-expanded:bg-charcoal-hover",
          "aria-expanded:text-cream-bright aria-pressed:bg-charcoal-hover",
        ],
        secondary: [
          "bg-charcoal-card text-cream hover:bg-charcoal-hover",
          "hover:text-cream-bright aria-expanded:bg-charcoal-hover",
          "aria-expanded:text-cream-bright aria-pressed:bg-charcoal-hover",
        ],
        // Same wash as the toolbar look, for ghost buttons that keep their own text color.
        ghost: [
          "hover:bg-control-hover hover:text-cream",
          "aria-pressed:bg-control-active aria-expanded:bg-control-active aria-expanded:text-cream",
          "data-[state=open]:bg-control-active data-[state=open]:text-cream",
        ],
        // The browser chrome's look: muted glyph, a soft wash of the text color on hover.
        // Washing with cream keeps it right on light surfaces too.
        toolbar: [
          "border-0 text-cream-muted hover:bg-control-hover hover:text-cream",
          "aria-pressed:bg-control-active aria-pressed:text-cream",
          "aria-expanded:bg-control-active aria-expanded:text-cream",
          "data-[state=open]:bg-control-active data-[state=open]:text-cream",
          // A menu trigger whose setting is on, e.g. agent access or a narrowed viewport.
          "data-[active=true]:bg-control-active data-[active=true]:text-cream",
          "focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-cream/15 disabled:opacity-40",
        ],
        link: "text-cream-bright underline-offset-4 hover:underline",
        // The one filled call to action on a surface: sign in, confirm, mark all read.
        primary: "bg-cream-bright text-charcoal-bg hover:bg-cream-action-hover",
        // Controls drawn over images and video: a dark translucent disc that reads on any media.
        overlay: [
          "border-cream/10 bg-charcoal-bg/75 text-cream backdrop-blur-sm",
          "hover:bg-charcoal-bg/90 hover:text-cream-bright",
        ],
        // Filters, tags, reactions, and presence: outlined until pressed, then filled.
        chip: [
          "rounded-full border-charcoal-border/70 text-cream-muted hover:bg-control-hover hover:text-cream",
          "aria-pressed:border-transparent aria-pressed:bg-charcoal-active aria-pressed:text-cream-bright",
          "data-[state=open]:bg-control-active data-[state=open]:text-cream",
        ],
        "nav-action": [
          "rounded-md border-0 bg-transparent p-0 text-cream-muted hover:bg-control-hover hover:text-cream",
          "aria-pressed:bg-control-active aria-expanded:bg-control-active data-[state=open]:bg-control-active",
          "focus-visible:ring-2 focus-visible:ring-cream/15 disabled:cursor-wait",
        ],
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
        chip: "h-7 gap-1.5 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        none: "",
      },
      justify: {
        center: "justify-center",
        start: "justify-start",
        end: "justify-end",
        between: "justify-between",
        none: "",
      },
      reveal: {
        always: "",
        "row-hover": [
          "opacity-0 pointer-events-none group-hover/app-row:opacity-100",
          "group-hover/app-row:pointer-events-auto",
          "group-focus-within/app-row:opacity-100",
          "group-focus-within/app-row:pointer-events-auto",
          "data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto",
          "[@media(hover:none)]:opacity-100",
          "[@media(hover:none)]:pointer-events-auto",
        ],
        "tree-hover":
          "!opacity-0 group-hover/tree-row:!opacity-100 group-focus-within/tree-row:!opacity-100 [@media(hover:none)]:!opacity-100",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      justify: "center",
      reveal: "always",
    },
  },
);

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, justify, reveal, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        data-slot="button"
        data-variant={variant ?? "default"}
        data-size={size ?? "default"}
        data-justify={justify ?? "center"}
        data-reveal={reveal ?? "always"}
        className={cn(buttonVariants({ variant, size, justify, reveal, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
