import { useMistyStore } from "@/features/misty/useMistyStore";
import { useLocalExecution } from "@/features/agents/localExecution";

/** An agent task is working on a screen, so Search stays out of its way. */
export function isAgentModeActive() {
  const execution = useLocalExecution.getState().execution;
  if (execution && execution.state !== "finished") return true;
  const state = useMistyStore.getState();
  return state.panel !== "closed" && state.working && (state.executionMode ?? "user") !== "user";
}
