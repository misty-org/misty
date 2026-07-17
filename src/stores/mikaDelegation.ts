import { agentArchitectureApi } from "../spaces/agentArchitectureApi";
import type { MikaDelegationResult } from "../spaces/types";

export async function tryMikaSpaceDelegation(prompt: string): Promise<MikaDelegationResult | null> {
  try { return await agentArchitectureApi.delegate({ prompt, input: { prompt } }); }
  catch { return null; }
}

export function publicMikaModel(model: string): string {
  return model === "mika-med" || model === "mika-high" ? model : "mika-low";
}

export function publicMikaDisplayName(model: string, modelName?: string): string {
  const expected = model === "mika-med" ? "Mika Med" : model === "mika-high" ? "Mika High" : "Mika Low";
  return modelName === expected ? modelName : expected;
}

export function mikaDelegationMessage(result: MikaDelegationResult): string {
  if (!result.run) {
    const choices = result.routing.options?.map((option) => `${option.agent_name} in ${option.space_name} (${option.capability_name})`) ?? [];
    return [result.routing.question || "Which Space agent should handle this?", ...choices.map((choice) => `• ${choice}`)].join("\n");
  }
  const output = typeof result.run.outputs?.text === "string"
    ? result.run.outputs.text
    : typeof result.run.result?.text === "string"
      ? result.run.result.text
      : "";
  const status = result.run.state === "awaiting_approval"
    ? `This run is waiting for your approval (run ${result.run.id}).`
    : result.run.state === "running"
      ? `The isolated run is in progress (run ${result.run.id}).`
      : "";
  return [result.trace, output, status].filter(Boolean).join("\n\n");
}
