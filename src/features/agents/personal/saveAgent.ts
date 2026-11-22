import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { personalAgentsApi } from "./personalAgentsApi";
import { usePersonalAgentsStore } from "./personalAgentsStore";

/** Saves an agent and puts it straight into the list everything reads, without a reload. */
export async function saveAgent(
  input: AgentProfileInput & { version?: number },
  id?: string,
): Promise<AgentProfile> {
  const saved = await personalAgentsApi.save(input, id);
  usePersonalAgentsStore.setState((state) => ({
    agents: state.agents.some((agent) => agent.id === saved.id)
      ? state.agents.map((agent) => (agent.id === saved.id ? saved : agent))
      : [...state.agents, saved],
  }));
  return saved;
}

/** Changes one of the person's agents' name, role or voice, keeping everything else about it. */
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
