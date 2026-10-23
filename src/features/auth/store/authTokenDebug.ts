export function recordRemoveError(error: unknown): void {
  recordTokenDebugEvent({
    level: "error",
    scope: "account-auth-token",
    message: "Could not remove the active Misty session from the device keystore.",
    detail: errorDetail(error),
  });
}

export function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}
export function recordTokenDebugEvent(event: {
  level: "info" | "warn" | "error";
  scope: string;
  message: string;
  detail?: string;
}): void {
  if (!tokenDebugEnabled()) return;
  void import("@/shared/platform/clientDebug").then(({ recordClientDebugEvent }) => {
    recordClientDebugEvent(event);
  });
}
function tokenDebugEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1";
}
