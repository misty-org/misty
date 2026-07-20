import * as React from "react";
import { Badge } from "@/ui";
import type { BadgeProps } from "@/models/types/ui/badge";
import { cn } from "@/ui";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export type StatusBadgeProps = BadgeProps & {
  dot?: boolean;
  status?: StatusTone;
};
