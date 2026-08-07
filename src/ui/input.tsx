import * as React from "react";

import { cn } from "@/ui";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        data-slot="input"
        className={cn(
          "h-9 w-full min-w-0 rounded-md border border-charcoal-border bg-transparent px-2.5 py-1",
          "text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-cream",
          "placeholder:text-cream-muted disabled:pointer-events-none disabled:cursor-not-allowed",
          "disabled:opacity-50 aria-invalid:border-charcoal-active aria-invalid:ring-3",
          "aria-invalid:ring-charcoal-active/20 md:text-sm bg-charcoal-card",
          "aria-invalid:border-charcoal-active/50 aria-invalid:ring-charcoal-active/40",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
