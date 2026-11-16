import { usePersonalAgentsStore } from "../personal/personalAgentsStore";

/** An agent's id and name, for what it adds to a notebook and what it's making there. */
export function agentTag(agentId: string): { id: string; name: string } {
  const profile = usePersonalAgentsStore.getState().agents.find((agent) => agent.id === agentId);
  return { id: agentId, name: profile?.name || "Agent" };
}
