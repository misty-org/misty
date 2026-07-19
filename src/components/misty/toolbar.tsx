import * as React from "react"

import { cn } from "@/lib/utils"

type ToolbarProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: string
  variant?: "default" | "floating" | "bare"
  wrap?: boolean
}

const Toolbar = React.forwardRef<HTMLDivElement, ToolbarProps>(
  (
    {
      className,
      label,
      variant = "default",
      wrap = false,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      data-slot="toolbar"
      className={cn(
        "flex min-h-11 min-w-0 items-center gap-2 px-3 py-1.5",
        wrap ? "flex-wrap" : "overflow-x-auto",
        variant === "default" && "border-b border-border/60 bg-background",
        variant === "floating" &&
          "rounded-lg bg-card shadow-xs ring-1 ring-foreground/10",
        variant === "bare" && "min-h-0 px-0 py-0",
        className,
      )}
      {...props}
    />
  ),
)
Toolbar.displayName = "Toolbar"

type ToolbarGroupProps = React.HTMLAttributes<HTMLDivElement> & {
  align?: "start" | "end"
  separated?: boolean
}

const ToolbarGroup = React.forwardRef<HTMLDivElement, ToolbarGroupProps>(
  ({ align = "start", className, separated = false, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toolbar-group"
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-1.5",
        align === "end" && "ml-auto",
        separated && "ml-1 border-l border-border/60 pl-2",
        className,
      )}
      {...props}
    />
  ),
)
ToolbarGroup.displayName = "ToolbarGroup"

export { Toolbar, ToolbarGroup, type ToolbarGroupProps, type ToolbarProps }
