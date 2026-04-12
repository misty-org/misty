import { agentArchitectureApi } from "@/stores/agents/useAgentArchitectureStore";
import type { AgentDelegationResult } from "@/models/interfaces/features/spaces/types";
import {
  initialAgentModelId,
  initialAgentModelName,
  selectedAgentModelName,
} from "@/features/agents/modelSelection";

const pendingDelegatedRunIDs = new Set<string>();

export async function tryAgentSpaceDelegation(
  prompt: string,
  sourceConversationId?: string,
): Promise<AgentDelegationResult | null> {
  try {
    return await agentArchitectureApi.delegate({
      prompt,
      input: { prompt },
      source_conversation_id: sourceConversationId,
    });
  } catch {
    return null;
  }
}

export function publicAgentModel(model: string): string {
  const normalized = model.trim();
  return isInternalModelLabel(normalized) ? initialAgentModelId : normalized || initialAgentModelId;
}

export function publicAgentDisplayName(model: string, modelName?: string): string {
  const normalizedName = modelName?.trim() ?? "";
  if (isInternalModelLabel(model) || isInternalModelLabel(normalizedName)) {
    return initialAgentModelName;
  }
  return normalizedName || selectedAgentModelName(model);
}

// Internal routing labels must never reach the user. Both the current "tier-*"
// values and the legacy "mika-*" ones are matched: the gateway still returns the
// legacy labels for sessions persisted before the agent rename, so narrowing this
// pattern to the new values would leak "Mika Low" into the model picker.
function isInternalModelLabel(value: string): boolean {
  return /^(automatic(?: routing)?|(?:tier|mika)[ -]?(?:low|med|medium|high))$/i.test(value.trim());
}

export function agentDelegationMessage(result: AgentDelegationResult): string {
  if (!result.run) {
    const choices =
      result.routing.options?.map(
        (option) => `${option.agent_name} in ${option.space_name} (${option.capability_name})`,
      ) ?? [];
    return [
      result.routing.question || "Which Space agent should handle this?",
      ...choices.map((choice) => `• ${choice}`),
    ].join("\n");
  }
  const output =
    typeof result.run.outputs?.text === "string"
      ? result.run.outputs.text
      : typeof result.run.result?.text === "string"
        ? result.run.result.text
        : "";
  const status =
    result.run.state === "awaiting_approval"
      ? `This run is waiting for your approval (run ${result.run.id}).`
      : result.run.state === "running"
        ? `The isolated run is in progress (run ${result.run.id}).`
        : "";
  return [result.trace, output, status].filter(Boolean).join("\n\n");
}

export function trackPendingAgentDelegation(result: AgentDelegationResult): boolean {
  const waiting =
    result.run?.state === "running" ||
    result.run?.state === "queued" ||
    result.run?.state === "cooldown" ||
    result.run?.state === "awaiting_approval";
  if (waiting && result.run) pendingDelegatedRunIDs.add(result.run.id);
  return waiting;
}

export const resolvePendingAgentDelegation = (runID?: string): void => {
  if (runID) pendingDelegatedRunIDs.delete(runID);
};
export const hasPendingAgentDelegations = (): boolean => pendingDelegatedRunIDs.size > 0;
export const clearPendingAgentDelegations = (): void => pendingDelegatedRunIDs.clear();
