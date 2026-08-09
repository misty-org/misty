import type { ReactNode } from "react";

export interface AuthShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  onBack?: () => void;
}
