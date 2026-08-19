import { resetPersonalAgentsAccountState, usePersonalAgentsStore } from "./usePersonalAgentsStore";
import { resetMcpConnectionsAccountState } from "../mcp/useMcpConnectionsStore";

export function resetAllAgentAccountState(): void {
  resetPersonalAgentsAccountState();
  resetMcpConnectionsAccountState();
  clearLegacyAgentChatState();
}

export function refreshAllAgentAccountState(): void {
  void usePersonalAgentsStore.getState().load();
}

function clearLegacyAgentChatState(): void {
  try {
    localStorage.removeItem("misty.baseAgentName");
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((key): key is string => Boolean(key));
    for (const key of keys) {
      if (key.startsWith("misty.agentDock.")) localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}
