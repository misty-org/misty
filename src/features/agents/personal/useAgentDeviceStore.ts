import type { AgentDevice } from "./agentScope";

/**
 * This computer, as its agents' grants name it. It needs no account and no server: an agent works here.
 */
export async function ensureAgentDevice(local: AgentDevice): Promise<{ id: string; name: string }> {
  return { id: local.id, name: local.displayName };
}
