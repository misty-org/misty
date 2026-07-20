import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/ui";

export interface AuthShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  onBack?: () => void;
}
