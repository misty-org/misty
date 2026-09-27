import * as React from "react";

import { cn } from "../utils";

const textareaVariants = {
  default: [
    "flex field-sizing-content min-h-16 w-full rounded-md border border-charcoal-border bg-transparent",
    "px-2.5 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none",
    "placeholder:text-cream-muted disabled:cursor-not-allowed disabled:opacity-50",
    "aria-invalid:border-charcoal-active aria-invalid:ring-3 aria-invalid:ring-charcoal-active/20",
    "md:text-sm bg-charcoal-card aria-invalid:border-charcoal-active/50",
    "aria-invalid:ring-charcoal-active/40",
  ],
  // A chat composer's message box: no frame, since the composer card around it is the frame.
  composer: [
    "w-full resize-none overflow-x-hidden bg-transparent text-cream outline-none",
    "placeholder:text-cream-muted disabled:cursor-not-allowed disabled:opacity-50",
  ],
} as const;

export type TextareaProps = React.ComponentProps<"textarea"> & {
  variant?: keyof typeof textareaVariants;
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant = "default", ...props }, ref) => {
    return (
      <textarea
        data-slot="textarea"
        data-variant={variant}
        className={cn(textareaVariants[variant], className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
