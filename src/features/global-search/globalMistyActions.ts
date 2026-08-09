import { useSpacesStore } from "@/features/spaces";
import type { GlobalAiActionProposal } from "./types";

export function proposeAction(prompt: string): GlobalAiActionProposal {
  const spacesState = useSpacesStore.getState();
  const requestedSpace = spacesState.spaces.find((space) =>
    prompt.toLocaleLowerCase().includes(space.name.toLocaleLowerCase()),
  );
  const space = requestedSpace ?? spacesState.spaces[0];
  const agents = space ? (spacesState.agentsBySpace[space.id] ?? []) : [];
  const agent = agents.find((item) => item.enabled && item.status !== "disabled");
  const readOnly = /^(find|search|show|list|summari[sz]e|explain|review|check)\b/i.test(prompt);
  return {
    id: `proposal-${globalMistyId()}`,
    title: readOnly ? "Run with Misty" : "Review this action",
    summary: readOnly
      ? `Misty will use ${agent?.name ?? "the best available Agent"} to ${lowerFirst(prompt)}.`
      : `Misty will ask ${agent?.name ?? "the best available Agent"} to ${lowerFirst(prompt)} after you confirm.`,
    prompt,
    risk: readOnly ? "read" : "write",
    state: "proposed",
    requiresConfirmation: !readOnly,
    ...(agent ? { agentId: agent.id, agentName: agent.name } : {}),
    ...(space ? { spaceId: space.id, spaceName: space.name } : {}),
  };
}

export function normalizeActionState(state: string): GlobalAiActionProposal["state"] {
  if (state === "awaiting_approval") return state;
  if (state === "completed" || state === "completed_with_errors") return "completed";
  if (state === "failed" || state === "canceled") return "failed";
  if (state === "rejected") return "rejected";
  return "running";
}

export function globalMistyError(error: unknown): string {
  return error instanceof Error ? error.message : "Misty could not complete that request.";
}

export function globalMistyId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function lowerFirst(value: string): string {
  const trimmed = value.trim().replace(/[.!?]+$/, "");
  return trimmed
    ? `${trimmed[0]?.toLocaleLowerCase()}${trimmed.slice(1)}`
    : "complete this request";
}
