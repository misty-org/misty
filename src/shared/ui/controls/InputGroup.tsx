import * as React from "react";

import { Button, type ButtonProps } from "./Button";
import { cn } from "../utils";

const InputGroup = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="input-group"
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg border " +
          "border-charcoal-border-strong bg-transparent shadow-xs " +
          "transition-[color,box-shadow] bg-charcoal-card",
        className,
      )}
      {...props}
    />
  ),
);
InputGroup.displayName = "InputGroup";

const InputGroupButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, ...props }, ref) => (
    <Button ref={ref} className={cn("shrink-0", className)} {...props} />
  ),
);
InputGroupButton.displayName = "InputGroupButton";

const InputGroupText = React.forwardRef<HTMLSpanElement, React.ComponentProps<"span">>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="input-group-text"
      className={cn("shrink-0 text-xs text-cream-muted", className)}
      {...props}
    />
  ),
);
InputGroupText.displayName = "InputGroupText";

export { InputGroup, InputGroupButton, InputGroupText };
