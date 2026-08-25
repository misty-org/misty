import { resetMcpConnectionsAccountState } from "../mcp/useMcpConnectionsStore";

export function resetAllAgentAccountState(): void {
  resetMcpConnectionsAccountState();
  clearLegacyAgentChatState();
}

export function refreshAllAgentAccountState(): void {
  // Tool connections load lazily when the managed Misty sheet is opened.
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
