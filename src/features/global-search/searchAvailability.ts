import { useMistyStore } from "@/features/misty/useMistyStore";
import { useLocalExecution } from "@/features/agents/localExecution";

export function isAgentModeActive() {
  if (useLocalExecution.getState().execution) return true;
  const state = useMistyStore.getState();
  const mode =
    (state.selectedAgentId && state.executionModeByAgent?.[state.selectedAgentId]) ||
    state.executionMode ||
    "user";
  return state.panel !== "closed" && mode !== "user";
}
