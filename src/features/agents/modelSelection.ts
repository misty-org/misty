export const initialAgentModelId = "google/gemini-2.5-flash-lite";
export const initialAgentModelName = "Gemini 2.5 Flash-Lite";

export function selectedAgentModelName(modelId: string): string {
  if (modelId === initialAgentModelId) return initialAgentModelName;
  const parts = modelId.trim().split("/");
  return parts[parts.length - 1] || "Choose a model";
}
