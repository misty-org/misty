import * as React from "react";

import { cn } from "../utils";

const inputVariants = {
  default: [
    "h-9 w-full min-w-0 rounded-md border border-charcoal-border bg-transparent px-2.5 py-1",
    "text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7",
    "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-cream",
    "placeholder:text-cream-muted disabled:pointer-events-none disabled:cursor-not-allowed",
    "disabled:opacity-50 aria-invalid:border-charcoal-active aria-invalid:ring-3",
    "aria-invalid:ring-charcoal-active/20 md:text-sm bg-charcoal-card",
    "aria-invalid:border-charcoal-active/50 aria-invalid:ring-charcoal-active/40",
  ],
  // The browser address bar: a quiet field that lifts on hover and focus.
  toolbar: [
    "h-[30px] w-full min-w-0 rounded-md border border-cream/[0.07] bg-transparent px-2",
    "text-xs text-cream outline-none transition-colors placeholder:text-cream-muted",
    "hover:bg-cream/[0.025] focus:border-cream/[0.12] focus:bg-cream/[0.04]",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
} as const;

export type InputProps = React.ComponentProps<"input"> & { variant?: keyof typeof inputVariants };

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = "default", ...props }, ref) => {
    return (
      <input
        type={type}
        data-slot="input"
        data-variant={variant}
        className={cn(inputVariants[variant], className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
