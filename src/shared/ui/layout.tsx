import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "./utils";

const boxVariants = cva("min-w-0", {
  variants: {
    display: {
      block: "block",
      inline: "inline",
      inlineBlock: "inline-block",
      flex: "flex",
      inlineFlex: "inline-flex",
      grid: "grid",
      hidden: "hidden",
    },
  },
  defaultVariants: {
    display: "block",
  },
});

export interface BoxProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof boxVariants> {
  asChild?: boolean;
}

export const Box = React.forwardRef<HTMLDivElement, BoxProps>(
  ({ className, display, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="box"
        className={cn(boxVariants({ display, className }))}
        {...props}
      />
    );
  },
);
Box.displayName = "Box";

const stackVariants = cva("flex flex-col min-w-0", {
  variants: {
    gap: {
      none: "gap-0",
      xs: "gap-1",
      sm: "gap-1.5",
      md: "gap-2",
      lg: "gap-3",
      xl: "gap-4",
      "2xl": "gap-6",
    },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
      baseline: "items-baseline",
    },
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
      around: "justify-around",
    },
  },
  defaultVariants: {
    gap: "none",
    align: "stretch",
    justify: "start",
  },
});

export interface StackProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof stackVariants> {
  asChild?: boolean;
}

export const Stack = React.forwardRef<HTMLDivElement, StackProps>(
  ({ className, gap, align, justify, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="stack"
        className={cn(stackVariants({ gap, align, justify, className }))}
        {...props}
      />
    );
  },
);
Stack.displayName = "Stack";

const flexRowVariants = cva("flex flex-row min-w-0 items-center", {
  variants: {
    gap: {
      none: "gap-0",
      xs: "gap-1",
      sm: "gap-1.5",
      md: "gap-2",
      lg: "gap-3",
      xl: "gap-4",
      "2xl": "gap-6",
    },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
      baseline: "items-baseline",
    },
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
      around: "justify-around",
    },
    wrap: {
      nowrap: "flex-nowrap",
      wrap: "flex-wrap",
    },
  },
  defaultVariants: {
    gap: "none",
    align: "center",
    justify: "start",
    wrap: "nowrap",
  },
});

export interface FlexRowProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof flexRowVariants> {
  asChild?: boolean;
}

export const FlexRow = React.forwardRef<HTMLDivElement, FlexRowProps>(
  ({ className, gap, align, justify, wrap, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="flex-row"
        className={cn(flexRowVariants({ gap, align, justify, wrap, className }))}
        {...props}
      />
    );
  },
);
FlexRow.displayName = "FlexRow";
