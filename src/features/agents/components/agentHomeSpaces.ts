import type { AgentProfile } from "@/shared/schemas";

interface AgentHomeGroup {
  id: string;
  name: string;
  agents: AgentProfile[];
}

/**
 * Agents grouped under their home Space, the personal Space first and the rest by name.
 * Without Spaces (the quick panel) it is one plain "Agents" list.
 */
export function agentsByHomeSpace(
  agents: AgentProfile[],
  spaces?: ReadonlyArray<{ id: string; name: string; is_default?: boolean }>,
): AgentHomeGroup[] {
  if (!spaces?.length) return [{ id: "agents", name: "Agents", agents }];
  const groups = new Map<string, AgentHomeGroup>();
  const personal = spaces.find((space) => space.is_default);
  for (const agent of agents) {
    const space = spaces.find((candidate) => candidate.id === agent.space_id) ?? personal;
    const id = space?.id ?? "agents";
    const group = groups.get(id) ?? { id, name: space?.name || "Agents", agents: [] };
    group.agents.push(agent);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.id === personal?.id ? -1 : b.id === personal?.id ? 1 : a.name.localeCompare(b.name),
  );
}
