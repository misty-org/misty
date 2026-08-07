import * as React from "react";

import { cn } from "@/ui";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        data-slot="textarea"
        className={cn(
          "flex field-sizing-content min-h-16 w-full rounded-md border border-charcoal-border bg-transparent",
          "px-2.5 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none",
          "placeholder:text-cream-muted disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-charcoal-active aria-invalid:ring-3 aria-invalid:ring-charcoal-active/20",
          "md:text-sm bg-charcoal-card aria-invalid:border-charcoal-active/50",
          "aria-invalid:ring-charcoal-active/40",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
