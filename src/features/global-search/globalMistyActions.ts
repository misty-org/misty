import type { GlobalAiActionProposal } from "./types";

export function normalizeActionState(state: string): GlobalAiActionProposal["state"] {
  if (state === "awaiting_approval") return state;
  if (state === "completed" || state === "completed_with_errors") return "completed";
  if (state === "failed" || state === "canceled") return "failed";
  if (state === "rejected") return "rejected";
  return "running";
}

export function globalMistyError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.trim().slice(0, 600) || "Misty could not complete that request.";
}

export function globalMistyId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
