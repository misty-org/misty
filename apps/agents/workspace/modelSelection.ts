export const initialAgentModelId = "poolside/laguna-s-2.1-free";
export const initialAgentModelName = "Laguna S 2.1 Free";

/**
 * The model a new chat starts on when neither the agent nor the chat overrides
 * it. Reads the user's configured default and falls back to the built-in, so an
 * unset or cleared setting behaves exactly as before.
 */
export function defaultAgentModelId(document: Record<string, unknown> | null | undefined): string {
  const agent = document?.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return initialAgentModelId;
  const configured = (agent as Record<string, unknown>).default_model_id;
  return typeof configured === "string" && configured.trim() ? configured : initialAgentModelId;
}

export function selectedAgentModelName(modelId: string): string {
  if (modelId === initialAgentModelId) return initialAgentModelName;
  const parts = modelId.trim().split("/");
  return parts[parts.length - 1] || "Choose a model";
}

const reasoningCapabilityMarkers = new Set(["reasoning", "thinking", "reasoning-effort"]);

/**
 * Whether a gateway model exposes adjustable reasoning effort. Driven by the
 * capabilities the gateway reports; adjust the marker set if the catalog labels
 * reasoning differently.
 */
export function modelSupportsReasoning(capabilities: string[] | undefined): boolean {
  return (capabilities ?? []).some((capability) =>
    reasoningCapabilityMarkers.has(capability.trim().toLowerCase()),
  );
}
