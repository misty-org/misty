import { Alert, AlertDescription } from "@/ui";
import { cn } from "@/ui";

export interface AuthMessageProps {
  tone: "error" | "success" | "muted";
  message: string;
}
