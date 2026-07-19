import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface AuthMessageProps {
  tone: "error" | "success" | "muted";
  message: string;
}

const toneClasses: Record<AuthMessageProps["tone"], string> = {
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  success: "border-misty-success/25 bg-misty-success/10 text-misty-success",
  muted: "border-border bg-muted text-muted-foreground",
};

export default function AuthMessage({ tone, message }: AuthMessageProps) {
  return (
    <Alert className={cn(toneClasses[tone])} variant={tone === "error" ? "destructive" : "default"}>
      <AlertDescription className="text-current">{message}</AlertDescription>
    </Alert>
  );
}
