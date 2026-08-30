import { Alert, AlertDescription, cn } from "@/shared/ui";

const toneClasses: Record<AuthMessageProps["tone"], string> = {
  error: "border-charcoal-active/30 bg-charcoal-active text-cream-bright",
  success: "border-status-green/25 bg-sage-bg text-sage-fg",
  muted: "border-charcoal-border bg-charcoal-card text-cream-muted",
};

export default function AuthMessage({ tone, message }: AuthMessageProps) {
  return (
    <Alert className={cn(toneClasses[tone])} variant={tone === "error" ? "destructive" : "default"}>
      <AlertDescription className="text-current">{message}</AlertDescription>
    </Alert>
  );
}

export interface AuthMessageProps {
  tone: "error" | "success" | "muted";
  message: string;
}
