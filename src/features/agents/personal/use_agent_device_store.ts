import type { AgentDevice } from "./agent_scope";

export async function ensureAgentDevice(local: AgentDevice): Promise<{ id: string; name: string }> {
  return { id: local.id, name: local.displayName };
}
