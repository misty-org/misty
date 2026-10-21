import { Notification } from "@/shared/ui";

/** Form feedback shows as a popup in the corner, so it never shifts the form around. */
export default function AuthMessage({ tone, message }: AuthMessageProps) {
  return (
    <Notification
      tone={tone === "error" ? "error" : tone === "success" ? "success" : "neutral"}
      duration={8000}
    >
      {message}
    </Notification>
  );
}

export interface AuthMessageProps {
  tone: "error" | "success" | "muted";
  message: string;
}
