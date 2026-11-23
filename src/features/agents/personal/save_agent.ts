import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { personalAgentsApi } from "./personal_agents_api";
import { usePersonalAgentsStore } from "./personal_agents_store";
import { copyAgentToSpace } from "./space_agent_sync";

function remember(saved: AgentProfile) {
  usePersonalAgentsStore.setState((state) => ({
    agents: state.agents.some((agent) => agent.id === saved.id)
      ? state.agents.map((agent) => (agent.id === saved.id ? saved : agent))
      : [...state.agents, saved],
  }));
  return saved;
}

export async function saveAgent(
  input: AgentProfileInput & { version?: number },
  id?: string,
  options?: { spaceId?: string },
): Promise<AgentProfile> {
  return remember(await personalAgentsApi.save(input, id, options));
}

export async function copyAgent(agent: AgentProfile, spaceId: string): Promise<AgentProfile> {
  return remember(await copyAgentToSpace(agent, spaceId));
}

export async function removeAgent(id: string): Promise<void> {
  await personalAgentsApi.remove(id);
  usePersonalAgentsStore.setState((state) => ({
    agents: state.agents.filter((agent) => agent.id !== id),
  }));
}

export function updateAgent(
  agent: AgentProfile,
  change: { name?: string; role?: string; voice?: string },
): Promise<AgentProfile> {
  const {
    name,
    role,
    description,
    instructions,
    icon,
    avatar,
    voice,
    model_mode,
    model_id,
    reasoning_effort,
    enabled,
    default_run_mode,
    engine,
    engine_model,
    version,
  } = agent;
  return saveAgent(
    {
      name: (change.name ?? name).trim(),
      role: (change.role ?? role).trim(),
      description,
      instructions,
      icon,
      avatar,
      voice: change.voice ?? voice,
      model_mode,
      model_id,
      reasoning_effort,
      enabled,
      default_run_mode,
      engine,
      engine_model,
      version,
    },
    agent.id,
  );
}
