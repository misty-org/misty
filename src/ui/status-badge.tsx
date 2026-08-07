import type { StatusTone, StatusBadgeProps } from "@/models/types/ui/status-badge";
export type { StatusTone, StatusBadgeProps } from "@/models/types/ui/status-badge";
import * as React from "react";
import { Badge } from "@/ui";
import type { BadgeProps } from "@/models/types/ui/badge";
import { cn } from "@/ui";

const statusClasses: Record<StatusTone, string> = {
  neutral: "border-charcoal-border bg-charcoal-card text-cream-muted",
  info: "border-charcoal-active/25 bg-charcoal-active text-cream-bright",
  success: "border-status-green/25 bg-status-green text-sage-fg",
  warning: "border-sage-fg/25 bg-sage-bg text-sage-fg",
  danger: "border-charcoal-active/25 bg-charcoal-active text-cream-bright",
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
