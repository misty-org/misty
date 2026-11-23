import type { AgentProfile } from "@/shared/schemas";

export function offeredAgents(agents: AgentProfile[]) {
  return agents.filter((agent) => !agent.system_managed);
}
