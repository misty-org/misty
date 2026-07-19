import * as React from "react"

import { Badge, type BadgeProps } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type StatusBadgeProps = Omit<BadgeProps, "variant"> & {
  status?: "neutral" | "info" | "success" | "warning" | "danger"
  dot?: boolean
}

const statusClasses: Record<NonNullable<StatusBadgeProps["status"]>, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info:
    "border-[color-mix(in_srgb,var(--misty-info)_35%,transparent)] bg-[color-mix(in_srgb,var(--misty-info)_12%,transparent)] text-[var(--misty-info)]",
  success:
    "border-[color-mix(in_srgb,var(--misty-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--misty-success)_12%,transparent)] text-[var(--misty-success)]",
  warning:
    "border-[color-mix(in_srgb,var(--misty-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--misty-warning)_12%,transparent)] text-[var(--misty-warning)]",
  danger:
    "border-[color-mix(in_srgb,var(--misty-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--misty-danger)_12%,transparent)] text-[var(--misty-danger)]",
}

function StatusBadge({
  children,
  className,
  dot = false,
  status = "neutral",
  ...props
}: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 rounded-md px-2 py-0.5 font-medium shadow-none",
        statusClasses[status],
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </Badge>
  )
}

export { StatusBadge, type StatusBadgeProps }
