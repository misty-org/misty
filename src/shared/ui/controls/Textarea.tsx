import * as React from "react";

import { cn } from "../classNames";

const textareaVariants = {
  // Framed like Input, with the same 14px text; it starts two lines tall and grows with its text.
  default: [
    "flex field-sizing-content min-h-16 w-full rounded-lg border border-charcoal-border-strong",
    "bg-charcoal-card px-2.5 py-1.5 text-control text-cream transition-colors outline-none",
    "placeholder:text-cream-muted hover:border-charcoal-active focus:border-cream-muted",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
  ],
  // Config files, commands and scripts: framed like default, in the code font at the meta size.
  // Lines don't wrap (the box scrolls sideways) and spelling isn't checked.
  code: [
    "flex field-sizing-content min-h-16 w-full rounded-lg border border-charcoal-border-strong",
    "bg-charcoal-card px-2.5 py-1.5 font-mono text-meta text-cream transition-colors outline-none",
    "overflow-x-auto whitespace-pre [tab-size:2]",
    "placeholder:font-sans placeholder:text-cream-muted",
    "hover:border-charcoal-active focus:border-cream-muted",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
  ],
  // A chat composer's message box: no frame, since the composer card around it is the frame.
  composer: [
    "w-full resize-none overflow-x-hidden bg-transparent text-cream outline-none",
    "placeholder:text-cream-muted disabled:cursor-not-allowed disabled:opacity-50",
  ],
} as const;

type TextareaProps = React.ComponentProps<"textarea"> & {
  /** default for prose, code for config and command editors, composer inside a composer. */
  variant?: keyof typeof textareaVariants;
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const code = variant === "code";
    return (
      <textarea
        data-slot="textarea"
        data-variant={variant}
        spellCheck={code ? false : undefined}
        autoCapitalize={code ? "off" : undefined}
        autoCorrect={code ? "off" : undefined}
        wrap={code ? "off" : undefined}
        className={cn(textareaVariants[variant], className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
