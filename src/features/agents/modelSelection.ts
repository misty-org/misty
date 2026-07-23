export const initialAgentModelId = "google/gemini-2.5-flash-lite";
export const initialAgentModelName = "Gemini 2.5 Flash-Lite";

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
