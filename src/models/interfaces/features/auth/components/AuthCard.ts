import type { ReactNode } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/ui";

export interface AuthCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}
