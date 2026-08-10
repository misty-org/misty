import { SpaceRequestError } from "@/services/spaces/api";

const accountSessionInvalidEvent = "misty:account-session-invalid";

export function notifyAccountSessionInvalid(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(accountSessionInvalidEvent));
}

export function isInaccessibleSpaceError(error: unknown): boolean {
  return error instanceof SpaceRequestError && (error.status === 403 || error.status === 404);
}
