import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { cn } from "../utils";

const inputVariants = {
  default: [
    "h-9 w-full min-w-0 rounded-md border border-charcoal-border-strong bg-transparent px-2.5 py-1",
    "text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7",
    "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-cream",
    "placeholder:text-cream-muted disabled:pointer-events-none disabled:cursor-not-allowed",
    "disabled:opacity-50 aria-invalid:border-charcoal-active aria-invalid:ring-3",
    "aria-invalid:ring-charcoal-active/20 md:text-sm bg-charcoal-card",
    "aria-invalid:border-charcoal-active/50 aria-invalid:ring-charcoal-active/40",
    "hover:border-charcoal-active",
  ],
  // The browser address bar: a filled pill, so it keeps its shape beside a bright page
  // where a hairline alone fades out.
  address: [
    "h-8 w-full min-w-0 rounded-md border border-transparent bg-cream/[0.07] px-2",
    "text-ui text-[var(--misty-theme-text-bright)] outline-none transition-colors",
    "placeholder:text-cream-muted hover:bg-cream/[0.10]",
    "focus:bg-cream/[0.12]",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  // Toolbar fields: a quiet field that lifts on hover and focus.
  toolbar: [
    "h-8 w-full min-w-0 rounded-md border border-cream/[0.07] bg-transparent px-2",
    "text-ui text-cream outline-none transition-colors placeholder:text-cream-muted",
    "hover:bg-cream/[0.025] focus:bg-cream/[0.04]",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  // No frame: for fields inside a container that already draws one (search pills, tab titles).
  bare: [
    "w-full min-w-0 bg-transparent text-sm text-cream outline-none placeholder:text-cream-muted",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
} as const;

type InputProps = React.ComponentProps<"input"> & {
  variant?: keyof typeof inputVariants;
  /** Sizes a password field and its eye together. */
  containerClassName?: string;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, containerClassName, type, variant = "default", ...props }, ref) => {
    const [revealed, setRevealed] = React.useState(false);
    const password = type === "password";
    const field = (
      <input
        type={password && revealed ? "text" : type}
        data-slot="input"
        data-variant={variant}
        className={cn(inputVariants[variant], className, password && "pr-10")}
        ref={ref}
        {...props}
      />
    );
    if (!password) return field;
    const Icon = revealed ? EyeOff : Eye;
    return (
      <div className={cn("relative w-full min-w-0", containerClassName)}>
        {field}
        <button
          type="button"
          aria-label={revealed ? "Hide password" : "Show password"}
          disabled={props.disabled}
          // Keeps the caret in the field while it switches.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setRevealed(!revealed)}
          className={cn(
            "absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-md",
            "text-cream-muted outline-none transition-colors hover:text-cream-bright",
            "focus-visible:text-cream-bright focus-visible:ring-2",
            "focus-visible:ring-charcoal-active disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
