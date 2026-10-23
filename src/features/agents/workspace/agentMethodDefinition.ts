import type { AgentMethodDefinition } from "@/api/ai/agent-methods";

export const methodTargets: { value: AgentMethodDefinition["target"]; label: string }[] = [
  { value: "cloud", label: "Connected apps and Misty context" },
  { value: "current_window", label: "This Misty window" },
];

/** Methods saved for the retired separate window run in this window. */
export const methodTarget = (definition: AgentMethodDefinition): AgentMethodDefinition["target"] =>
  definition.target === "cloud" ? "cloud" : "current_window";

export const methodTargetLabel = (definition: AgentMethodDefinition) =>
  methodTargets.find((t) => t.value === methodTarget(definition))?.label;

export const blankDefinition = (): AgentMethodDefinition => ({
  title: "",
  description: "",
  instructions: "",
  inputs: [],
  target: "cloud",
  required_tools: [],
});
export function methodError(error: unknown) {
  if (error && typeof error === "object" && "status" in error && error.status === 409)
    return (
      "This method changed or a method limit was reached. Your draft is kept here. " +
      "Reload the latest version; if eight skills are enabled, disable one before adding another."
    );
  return error instanceof Error
    ? error.message
    : "The request failed. Your changes have been kept; try again.";
}
