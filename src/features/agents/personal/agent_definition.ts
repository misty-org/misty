import {
  agentDefinitionKeys,
  type AgentDefinition,
  type AgentProfile,
  type AgentProfileInput,
} from "@/shared/schemas";
import type { SpaceAgent, SpaceAgentDefinition } from "../api/space_agents";

export function definitionOf(agent: AgentProfileInput): Omit<SpaceAgentDefinition, "revision"> {
  return {
    name: agent.name.trim(),
    role: agent.role ?? "",
    description: agent.description ?? "",
    instructions: agent.instructions ?? "",
    soul: agent.soul ?? "",
    icon: agent.icon ?? "",
    avatar: agent.avatar ?? {},
    voice_id: agent.voice ?? "",
    engine_id: agent.engine ?? "",
    engine_model: agent.engine_model ?? "",
    reasoning_effort: agent.reasoning_effort ?? "",
    origin: agent.origin ?? "",
  };
}

export function definitionFields(agent: AgentProfileInput): AgentDefinition {
  return Object.fromEntries(agentDefinitionKeys.map((key) => [key, agent[key]])) as AgentDefinition;
}

export function sameDefinition(a: AgentProfileInput, b: AgentProfileInput) {
  return JSON.stringify(definitionOf(a)) === JSON.stringify(definitionOf(b));
}

const optional = (value: string) => value || undefined;

function definitionFromSpace(server: SpaceAgent): AgentDefinition {
  return {
    name: server.agent_name,
    role: server.role,
    description: server.description,
    instructions: server.instructions,
    soul: optional(server.soul),
    icon: server.icon,
    avatar: server.avatar as AgentProfile["avatar"],
    voice: optional(server.voice_id),
    engine: optional(server.engine_id),
    engine_model: optional(server.engine_model),
    reasoning_effort: server.reasoning_effort,
    origin: optional(server.origin),
  };
}

export function withSpace(local: AgentProfile, server: SpaceAgent): AgentProfile {
  return {
    ...local,
    ...definitionFromSpace(server),
    id: server.agent_id,
    owner_user_id: server.owner_user_id,
    space_id: server.space_id,
    revision: server.revision,
    can_edit: server.can_edit,
    system_managed: false,
    created_at: server.added_at || local.created_at,
    updated_at: server.updated_at || local.updated_at,
  };
}

export function fromSpace(server: SpaceAgent): AgentProfile {
  return withSpace(
    {
      id: server.agent_id,
      owner_user_id: server.owner_user_id,
      name: server.agent_name,
      role: "",
      description: "",
      instructions: "",
      icon: "",
      avatar: {},
      model_mode: "automatic",
      model_id: "",
      reasoning_effort: "",
      enabled: true,
      default_run_mode: "ask",
      system_managed: false,
      space_id: server.space_id,
      version: 1,
      created_at: server.added_at,
      updated_at: server.updated_at || server.added_at,
    },
    server,
  );
}

export function differsFromSpace(local: AgentProfile, server: SpaceAgent) {
  const next = withSpace(local, server);
  return JSON.stringify({ ...next, version: 0 }) !== JSON.stringify({ ...local, version: 0 });
}
