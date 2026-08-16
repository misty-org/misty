import { apiRequest } from "@/api/client";

export type AgentMethodKind = "workflow" | "template" | "skill";
export type AgentMethodInputs = Record<string, string | number | boolean>;
export interface AgentMethodInput {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "choice";
  required: boolean;
  options?: string[];
}
export interface AgentMethodDefinition {
  title: string;
  description: string;
  instructions: string;
  inputs: AgentMethodInput[];
  target: "cloud" | "separate_window" | "current_window";
  required_tools: string[];
}
export interface AgentMethod {
  id: string;
  agent_id: string;
  kind: AgentMethodKind;
  enabled: boolean;
  version_id: string;
  version: number;
  definition: AgentMethodDefinition;
  source_invocation_id?: string;
  updated_at: string;
}
export interface SaveAgentMethod {
  id?: string;
  agent_id: string;
  kind: AgentMethodKind;
  enabled: boolean;
  expected_version?: number;
  source_invocation_id?: string;
  definition: AgentMethodDefinition;
}
const base = "/ai/agent-methods";
export const agentMethodsApi = {
  list: (agentId: string) =>
    apiRequest<{ methods: AgentMethod[] }>(`${base}?agent_id=${encodeURIComponent(agentId)}`, {
      cache: "no-store",
    }),
  save: (input: SaveAgentMethod) =>
    apiRequest<{ method: AgentMethod }>(
      input.id ? `${base}/${encodeURIComponent(input.id)}` : base,
      { method: input.id ? "PUT" : "POST", body: JSON.stringify(input) },
    ),
  instantiate: (versionId: string, inputs: AgentMethodInputs) =>
    apiRequest<{ prompt: string; method: AgentMethod }>(`${base}/instantiate`, {
      method: "POST",
      body: JSON.stringify({ version_id: versionId, inputs }),
    }),
};
