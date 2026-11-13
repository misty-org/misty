import type { AgentProfile } from "@/shared/schemas";

/**
 * The person's agents as they are offered: every agent on one of their engines. Misty's own
 * agent runs on Misty's own runtime, which stays in the code but is never offered; a chat already
 * with it still names it.
 */
export function offeredAgents(agents: AgentProfile[]) {
  return agents.filter((agent) => !agent.system_managed);
}
