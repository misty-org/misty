import { useEffect } from "react";
import { notify } from "@misty/ui";

export default function AuthMessage({ tone, message }: AuthMessageProps) {
  useEffect(() => {
    const notice = notify({
      message,
      tone: tone === "error" ? "error" : "neutral",
      duration: 8000,
    });
    return () => notice.dismiss();
  }, [tone, message]);
  return null;
}

interface AuthMessageProps {
  tone: "error" | "success" | "muted";
  message: string;
}
