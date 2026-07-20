import type { StatusTone, StatusBadgeProps } from "@/models/types/ui/status-badge";
export type { StatusTone, StatusBadgeProps } from "@/models/types/ui/status-badge";
import * as React from "react";
import { Badge } from "@/ui";
import type { BadgeProps } from "@/models/types/ui/badge";
import { cn } from "@/ui";

const statusClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-primary/25 bg-primary/10 text-primary",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-500",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-500",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
};

function StatusBadge({
  children,
  className,
  dot = false,
  status = "neutral",
  variant = "outline",
  ...props
}: StatusBadgeProps) {
  return (
    <Badge variant={variant} className={cn(statusClasses[status], className)} {...props}>
      {dot ? (
        <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {children}
    </Badge>
  );
}
export { StatusBadge };
