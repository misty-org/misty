import { Alert, AlertDescription } from "@/components/ui/alert";

interface AuthMessageProps {
  tone: "error" | "success" | "muted";
  message: string;
}

const toneClasses: Record<AuthMessageProps["tone"], string> = {
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  success: "border-success/30 bg-success/10 text-success",
  muted: "border-border bg-muted/40 text-muted-foreground",
};

export default function AuthMessage({ tone, message }: AuthMessageProps) {
  const isError = tone === "error";

  return (
    <Alert
      variant={isError ? "destructive" : "default"}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      className={toneClasses[tone]}
    >
      <AlertDescription className="text-current">{message}</AlertDescription>
    </Alert>
  );
}
