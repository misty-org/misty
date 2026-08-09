import { resetPersonalAgentsAccountState, usePersonalAgentsStore } from "./usePersonalAgentsStore";

export function resetAllAgentAccountState(): void {
  resetPersonalAgentsAccountState();
  clearLegacyAgentChatState();
}

export function refreshAllAgentAccountState(): void {
  void usePersonalAgentsStore.getState().load();
}

function clearLegacyAgentChatState(): void {
  try {
    localStorage.removeItem("misty.baseAgentName");
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("misty.agentDock.")) localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}
