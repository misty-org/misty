import type { ReactNode } from "react";
import { Card, CardHeader } from "@/ui";
import { cn } from "@/ui";

export interface PanelProps {
  as?: "aside" | "section" | "div";
  className?: string;
  children: ReactNode;
}

export interface PanelHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}
