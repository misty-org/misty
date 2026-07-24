import { create } from "zustand";
import { errorText } from "@/lib/format";
import type {
  GatewayModel,
  PersonalAgent,
  PersonalAgentGrant,
} from "@/models/interfaces/features/agents/personal";
import { spaceRequest } from "@/stores/spaces/useSpacesBackendStore";
import { initialAgentModelId } from "@/features/agents/modelSelection";

type AgentInput = Pick<
  PersonalAgent,
  | "name"
  | "description"
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
  list: () => spaceRequest<{ agents: PersonalAgent[] }>("/agents"),
  create: (input: AgentInput) =>
    spaceRequest<PersonalAgent>("/agents", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, input: AgentInput) =>
    spaceRequest<PersonalAgent>(`/agents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) => spaceRequest(`/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  grants: (id: string) =>
    spaceRequest<{ grants: PersonalAgentGrant[] }>(
      `/agents/${encodeURIComponent(id)}/space-grants`,
    ),
  replaceGrants: (
    id: string,
    spaces: Array<{ space_id: string; all_members: boolean; member_user_ids: string[] }>,
  ) =>
    spaceRequest<{ grants: PersonalAgentGrant[] }>(
      `/agents/${encodeURIComponent(id)}/space-grants`,
      { method: "PUT", body: JSON.stringify({ spaces }) },
    ),
  models: () => spaceRequest<{ catalog_version: string; models: GatewayModel[] }>("/ai/models"),
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
  error: string | null;
  load: () => Promise<void>;
  save: (id: string | null, input: AgentInput) => Promise<PersonalAgent>;
  remove: (id: string) => Promise<void>;
}

export const usePersonalAgentsStore = create<PersonalAgentsStore>((set, get) => ({
  agents: [],
  models: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    const [agents, models] = await Promise.allSettled([
      personalAgentsApi.list(),
      personalAgentsApi.models(),
    ]);
    set({
      agents:
        agents.status === "fulfilled" ? agents.value.agents.map(withConcreteModelSelection) : [],
      models: models.status === "fulfilled" ? models.value.models.filter(isMajorProviderModel) : [],
      loading: false,
      error: agents.status === "rejected" ? errorText(agents.reason) : null,
    });
  },
  save: async (id, input) => {
    const savedResponse = id
      ? await personalAgentsApi.update(id, input)
      : await personalAgentsApi.create(input);
    const saved = withConcreteModelSelection(savedResponse);
    set({
      agents: id
        ? get().agents.map((agent) => (agent.id === saved.id ? saved : agent))
        : [...get().agents, saved].sort((a, b) => a.name.localeCompare(b.name)),
      error: null,
    });
    return saved;
  },
  remove: async (id) => {
    await personalAgentsApi.remove(id);
    set({ agents: get().agents.filter((agent) => agent.id !== id), error: null });
  },
}));

function withConcreteModelSelection(agent: PersonalAgent): PersonalAgent {
  if (agent.model_mode === "pinned" && agent.model_id) return agent;
  return { ...agent, model_mode: "pinned", model_id: initialAgentModelId };
}
