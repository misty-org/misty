import type { BadgeProps } from "@/shared/ui/model/types/badge";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export type StatusBadgeProps = BadgeProps & {
  dot?: boolean;
  status?: StatusTone;
};
