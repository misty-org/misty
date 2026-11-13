import { SpaceRequestError } from "./api";
import { notifyApiSessionInvalid } from "@/api/client/session";

export function notifyAccountSessionInvalid(): void {
  notifyApiSessionInvalid();
}

export function isInaccessibleSpaceError(error: unknown): boolean {
  return error instanceof SpaceRequestError && (error.status === 403 || error.status === 404);
}
