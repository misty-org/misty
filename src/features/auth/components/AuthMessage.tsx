import { cn } from "@/shared/ui";

const toneClasses: Record<AuthMessageProps["tone"], string> = {
  error: "text-cream",
  success: "text-cream",
  muted: "text-cream-muted",
};

/** A short status line under a form: small text, no box, so it never pushes the layout wide. */
export default function AuthMessage({ tone, message }: AuthMessageProps) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("break-words text-center text-xs leading-5", toneClasses[tone])}
    >
      {message}
    </p>
  );
}

export interface AuthMessageProps {
  tone: "error" | "success" | "muted";
  message: string;
}
