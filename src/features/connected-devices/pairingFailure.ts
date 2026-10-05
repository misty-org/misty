import { ManagedAiRequestError } from "@/features/agents";

export interface PairingFailure {
  title: string;
  description: string;
  action: string;
}

export function pairingFailure(cause: unknown): PairingFailure {
  const code = cause instanceof ManagedAiRequestError ? cause.code : undefined;
  if (code === "pairing_not_found") {
    return {
      title: "Code not found",
      description:
        "That pairing code is incorrect or no longer active. Check the code on the other device and try again.",
      action: "Try again",
    };
  }
  if (code === "pairing_expired") {
    return {
      title: "Code expired",
      description:
        "Pairing codes expire after five minutes. Generate a new code on the other device and try again.",
      action: "Try again",
    };
  }
  if (code === "pairing_locked") {
    return {
      title: "Too many attempts",
      description:
        "That pairing session was locked after too many incorrect attempts. Generate a new code and try again.",
      action: "Got it",
    };
  }
  if (code === "invalid_pairing_state") {
    return {
      title: "Pairing changed",
      description:
        "That pairing request is no longer waiting for this device. Start a new pairing.",
      action: "Got it",
    };
  }
  const message = cause instanceof Error ? cause.message.trim() : "";
  const safeMessage =
    message && !message.startsWith("{") && message !== "invalid request"
      ? message
      : "Check the pairing code and your connection, then try again.";
  return {
    title: "Couldn’t connect this device",
    description: safeMessage,
    action: "Try again",
  };
}
