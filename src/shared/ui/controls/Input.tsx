import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { cn } from "../classNames";
import { controlFrame, fieldInset } from "./controlFrame";
import { IconButton } from "./IconButton";

/** Every framed field is 32px tall, the height of the buttons beside it, with 14px text. */
const inputVariants = {
  default: [
    controlFrame.md,
    fieldInset.md,
    "w-full min-w-0 border border-charcoal-border-strong bg-charcoal-card",
    "text-control text-cream transition-colors outline-none",
    "placeholder:text-cream-muted hover:border-charcoal-active focus:border-cream-muted",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
    "aria-invalid:border-danger",
  ],
  // The browser address bar: a filled field, so it keeps its shape beside a bright page
  // where a hairline alone fades out.
  address: [
    controlFrame.md,
    "w-full min-w-0 border border-transparent bg-cream/7 px-2",
    "text-control text-cream-bright outline-none transition-colors",
    "placeholder:text-cream-muted hover:bg-cream/10 focus:bg-cream/12",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  // Toolbar fields: a quiet field that lifts on hover and focus.
  toolbar: [
    controlFrame.md,
    "w-full min-w-0 border border-cream/7 bg-transparent px-2",
    "text-control text-cream outline-none transition-colors placeholder:text-cream-muted",
    "hover:bg-cream/3 focus:bg-cream/4",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  // Renaming in place in a header: reads as the title itself (the page role, semibold), with no
  // frame until it is hovered or focused. The negative margin keeps its text in line with the
  // header around it while the frame's padding is invisible.
  title: [
    controlFrame.md,
    "-mx-2 w-[calc(100%+1rem)] min-w-0 border border-transparent bg-transparent px-2",
    "text-page font-semibold text-cream-bright outline-none transition-colors",
    "placeholder:text-cream-muted hover:border-charcoal-border",
    "focus:border-charcoal-border-strong focus:bg-charcoal-card",
    "disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger",
  ],
  // A field on a smoke panel floating over the desktop (Surface tone="smoke"): a faint white
  // frame and fill, outlined brighter while typing in it. It keeps the panel's text size.
  smoke: [
    controlFrame.md,
    fieldInset.md,
    "w-full min-w-0 border border-white/18 bg-white/6",
    "text-art-white outline-none placeholder:text-cream-muted",
    "focus:outline focus:outline-white/55",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  // A 24px field in a row of 24px chips or buttons, such as renaming a speaker in place.
  compact: [
    controlFrame.sm,
    fieldInset.sm,
    "w-full min-w-0 border border-charcoal-border-strong bg-charcoal-card",
    "text-caption text-cream transition-colors outline-none",
    "placeholder:text-cream-muted hover:border-charcoal-active focus:border-cream-muted",
    "disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger",
  ],
  // No frame: for fields inside a container that already draws one (search pills, tab titles).
  bare: [
    "w-full min-w-0 bg-transparent text-control text-cream outline-none placeholder:text-cream-muted",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
} as const;

type InputProps = React.ComponentProps<"input"> & {
  /**
   * default is the framed 32px field; compact is the 24px one for a row of small controls. Its
   * height and corners are fixed: never set them with className. title renames something in place in a header:
   * `<Input variant="title" aria-label="Space name" value={name} onChange={…} />`.
   */
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
        className={cn(inputVariants[variant], className, password && "pr-8")}
        ref={ref}
        {...props}
      />
    );
    if (!password) return field;
    const Icon = revealed ? EyeOff : Eye;
    return (
      <div className={cn("relative w-full min-w-0", containerClassName)}>
        {field}
        <span className="absolute inset-y-0 right-1 flex items-center">
          <IconButton
            label={revealed ? "Hide password" : "Show password"}
            variant="quiet"
            size="sm"
            disabled={props.disabled}
            // Keeps the caret in the field while it switches.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setRevealed(!revealed)}
          >
            <Icon aria-hidden="true" />
          </IconButton>
        </span>
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
