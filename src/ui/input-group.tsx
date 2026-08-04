import * as React from "react";

import { Button, type ButtonProps } from "./button";
import { cn } from "./utils";

const InputGroup = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="input-group"
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg border border-input bg-transparent shadow-xs transition-[color,box-shadow] dark:bg-input/30",
        className,
      )}
      {...props}
    />
  ),
);
InputGroup.displayName = "InputGroup";

const InputGroupTextarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      data-slot="input-group-textarea"
      className={cn(
        "field-sizing-content max-h-40 min-h-20 min-w-0 max-w-full w-full resize-none overflow-x-hidden whitespace-pre-wrap break-words border-0 bg-transparent px-3 py-3 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-transparent",
        className,
      )}
      {...props}
    />
  ),
);
InputGroupTextarea.displayName = "InputGroupTextarea";

const InputGroupAddon = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    align?: "block-start" | "block-end";
  }
>(({ align = "block-start", className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="input-group-addon"
    data-align={align}
    className={cn(
      "flex min-h-10 items-center gap-1 px-2 py-1.5",
      align === "block-start" ? "order-first" : "order-last",
      className,
    )}
    {...props}
  />
));
InputGroupAddon.displayName = "InputGroupAddon";

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
      className={cn("shrink-0 text-xs text-muted-foreground", className)}
      {...props}
    />
  ),
);
InputGroupText.displayName = "InputGroupText";

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea };
