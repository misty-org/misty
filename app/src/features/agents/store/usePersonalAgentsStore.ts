import { agentsApi } from "@/api/agents/api";
import type { AgentToolboxResponse } from "@/api/spaces/dto/interfaces/agentArchitectureTypes";
import { errorText } from "@/shared/lib/format";
import { create } from "zustand";
import type { GatewayModel, PersonalAgent, PersonalAgentGrant } from "../model/interfaces/personal";
import { initialAgentModelId } from "../modelSelection";

type AgentInput = Pick<
  PersonalAgent,
  | "name"
  | "role"
  | "description"
  | "avatar"
  | "icon"
  | "instructions"
  | "model_mode"
  | "model_id"
  | "reasoning_effort"
  | "context_permissions"
  | "tool_permissions"
  | "enabled"
> & { version?: number };

export const personalAgentsApi = {
  list: () => agentsApi.list<PersonalAgent>(),
  create: (input: AgentInput) => agentsApi.create<PersonalAgent>(input),
  update: (id: string, input: AgentInput) => agentsApi.update<PersonalAgent>(id, input),
  remove: agentsApi.remove,
  grants: (id: string) => agentsApi.grants<PersonalAgentGrant>(id),
  toolboxCatalog: () => agentsApi.toolboxCatalog<AgentToolboxResponse>(),
  toolbox: (id: string) => agentsApi.toolbox<AgentToolboxResponse>(id),
  uploadAvatar: (id: string, file: File) => agentsApi.uploadAvatar<PersonalAgent>(id, file),
  replaceGrants: (
    id: string,
    spaces: Array<{ space_id: string; all_members: boolean; member_user_ids: string[] }>,
  ) => agentsApi.replaceGrants<PersonalAgentGrant>(id, spaces),
  models: () => agentsApi.models<GatewayModel>(),
};

// The gateway exposes dozens of providers; surface only the ones people recognize.
const allowedModelProviders = new Set(["openai", "anthropic", "google"]);

function isMajorProviderModel(model: GatewayModel): boolean {
  const provider = model.id.split("/")[0]?.toLowerCase() ?? "";
  return allowedModelProviders.has(provider);
}

interface PersonalAgentsStore {
  agents: PersonalAgent[];
  models: GatewayModel[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: (id: string | null, input: AgentInput) => Promise<PersonalAgent>;
  remove: (id: string) => Promise<void>;
}

let personalAgentsAccountGeneration = 0;

export const usePersonalAgentsStore = create<PersonalAgentsStore>((set, get) => ({
  agents: [],
  models: [],
  loading: false,
  loaded: false,
  error: null,
  load: async () => {
    const generation = personalAgentsAccountGeneration;
    set({ loading: true, error: null });
    const [agents, models] = await Promise.allSettled([
      personalAgentsApi.list(),
      personalAgentsApi.models(),
    ]);
    if (generation !== personalAgentsAccountGeneration) return;
    set({
      agents:
        agents.status === "fulfilled" ? agents.value.agents.map(withConcreteModelSelection) : [],
      models: models.status === "fulfilled" ? models.value.models.filter(isMajorProviderModel) : [],
      loading: false,
      loaded: true,
      error: agents.status === "rejected" ? errorText(agents.reason) : null,
    });
  },
  save: async (id, input) => {
    const generation = personalAgentsAccountGeneration;
    const savedResponse = id
      ? await personalAgentsApi.update(id, input)
      : await personalAgentsApi.create(input);
    const saved = withConcreteModelSelection(savedResponse);
    if (generation !== personalAgentsAccountGeneration) {
      throw new Error("The active account changed while the Agent was being saved.");
    }
    set({
      agents: id
        ? get().agents.map((agent) => (agent.id === saved.id ? saved : agent))
        : [...get().agents, saved].sort((a, b) => a.name.localeCompare(b.name)),
      error: null,
      loaded: true,
    });
    return saved;
  },
  remove: async (id) => {
    const generation = personalAgentsAccountGeneration;
    await personalAgentsApi.remove(id);
    if (generation !== personalAgentsAccountGeneration) return;
    set({ agents: get().agents.filter((agent) => agent.id !== id), error: null });
  },
}));

export function resetPersonalAgentsAccountState(): void {
  personalAgentsAccountGeneration += 1;
  usePersonalAgentsStore.setState({
    agents: [],
    models: [],
    loading: false,
    loaded: false,
    error: null,
  });
}

function withConcreteModelSelection(agent: PersonalAgent): PersonalAgent {
  if (agent.model_mode === "pinned" && agent.model_id) return agent;
  return { ...agent, model_mode: "pinned", model_id: initialAgentModelId };
}
