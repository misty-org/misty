import type { PersonalAgent } from "./model/interfaces/personal";

const retiredLegacyAgentNames = new Set(["buzz", "steve"]);

export function isRetiredLegacyAgent(agent: Pick<PersonalAgent, "name">): boolean {
  return retiredLegacyAgentNames.has(agent.name.trim().toLocaleLowerCase());
}

export function withoutRetiredLegacyAgents(agents: PersonalAgent[]): PersonalAgent[] {
  return agents.filter((agent) => !isRetiredLegacyAgent(agent));
}
