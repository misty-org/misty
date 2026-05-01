import { Badge } from "./badge";
import { cn } from "./utils";
import type { StatusBadgeProps, StatusTone } from "@/shared/ui/model/types/status-badge";
export type { StatusBadgeProps, StatusTone } from "@/shared/ui/model/types/status-badge";
export { StatusBadge };

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
