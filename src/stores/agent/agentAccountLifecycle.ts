import { resetAgentAccountState, useAgentSessionStore } from "./useAgentSessionStore";
import {
  resetPersonalAgentsAccountState,
  usePersonalAgentsStore,
} from "@/stores/agents/usePersonalAgentsStore";

export function resetAllAgentAccountState(): void {
  resetAgentAccountState();
  resetPersonalAgentsAccountState();
}

export function refreshAllAgentAccountState(): void {
  void useAgentSessionStore.getState().refreshStatus();
  void usePersonalAgentsStore.getState().load();
}
