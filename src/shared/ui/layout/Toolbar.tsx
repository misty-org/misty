import * as React from "react";

import { cn } from "../utils";

const Toolbar = React.forwardRef<HTMLDivElement, ToolbarProps>(
  ({ className, label, variant = "default", wrap = false, ...props }, ref) => (
    <div
      ref={ref}
      role="toolbar"
      data-window-toolbar={variant !== "floating" && variant !== "bare" ? "true" : undefined}
      aria-label={label}
      className={cn(
        // The browser chrome's geometry: 44px bar, 4px rhythm, 30px icon buttons.
        "flex min-h-11 min-w-0 shrink-0 items-center gap-1 px-2 py-1",
        wrap ? "flex-wrap" : "overflow-x-auto",
        variant === "default" && "border-b border-charcoal-border/60 bg-charcoal-bg",
        variant === "floating" &&
          "rounded-lg bg-charcoal-card shadow-xs ring-1 ring-charcoal-border",
        variant === "bare" && "min-h-0 px-0 py-0",
        className,
      )}
      {...props}
    />
  ),
);
Toolbar.displayName = "Toolbar";

const ToolbarGroup = React.forwardRef<HTMLDivElement, ToolbarGroupProps>(
  ({ align = "start", className, separated = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex min-w-0 items-center gap-1",
        align === "end" && "ml-auto",
        separated && "border-l border-charcoal-border/60 pl-1",
        className,
      )}
      {...props}
    />
  ),
);
ToolbarGroup.displayName = "ToolbarGroup";
export { Toolbar, ToolbarGroup };

export type ToolbarProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: string;
  variant?: "default" | "floating" | "bare";
  wrap?: boolean;
};

export type ToolbarGroupProps = React.HTMLAttributes<HTMLDivElement> & {
  align?: "start" | "end";
  separated?: boolean;
};
