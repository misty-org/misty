import type { ReactNode } from "react";

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
