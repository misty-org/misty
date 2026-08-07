import type { StatusTone, StatusBadgeProps } from "@/models/types/ui/status-badge";
export type { StatusTone, StatusBadgeProps } from "@/models/types/ui/status-badge";
import * as React from "react";
import { Badge } from "@/ui";
import type { BadgeProps } from "@/models/types/ui/badge";
import { cn } from "@/ui";

const statusClasses: Record<StatusTone, string> = {
  neutral: "border-charcoal-border bg-charcoal-card text-cream-muted",
  info: "border-transparent bg-avatar-blue text-avatar-ink",
  success: "border-transparent bg-status-green text-avatar-ink",
  warning: "border-transparent bg-avatar-yellow text-avatar-ink",
  danger: "border-transparent bg-avatar-red text-avatar-ink",
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
