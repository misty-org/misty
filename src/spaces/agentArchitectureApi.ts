import { spaceRequest } from "./api";
import type {
  AgentCatalogEntry,
  MikaDelegationResult,
  PrivateAgentConversation,
  PrivateConversationEvent,
  RoutingDecision,
  RunAction,
  RunApproval,
  SpaceIntegration,
  SpaceRun,
  SpaceStudioResource,
  WorkflowMetadata,
  WorkflowVersion,
} from "./types";

export interface AgentInvocationInput {
  prompt: string;
  capability_id?: string;
  source_conversation_id?: string;
  input?: Record<string, unknown>;
}

export type AgentInvocationResult = SpaceRun | MikaDelegationResult | {
  status: "needs_clarification";
  routing: RoutingDecision;
};

const part = encodeURIComponent;

export const agentArchitectureApi = {
  catalog: () => spaceRequest<{ agents: AgentCatalogEntry[] }>("/agents/catalog"),
  discovery: () => spaceRequest<{ agents: AgentCatalogEntry[] }>("/mika/discovery"),
  delegate: (input: AgentInvocationInput & { space_id?: string; agent_id?: string }) =>
    spaceRequest<MikaDelegationResult>("/mika/delegations", { method: "POST", body: JSON.stringify(input) }),
  runs: (spaceId: string, agentId: string) =>
    spaceRequest<{ runs: SpaceRun[] }>(`/spaces/${part(spaceId)}/agents/${part(agentId)}/runs`),
  run: (spaceId: string, agentId: string, input: AgentInvocationInput) =>
    spaceRequest<AgentInvocationResult>(`/spaces/${part(spaceId)}/agents/${part(agentId)}/runs`, { method: "POST", body: JSON.stringify(input) }),
  runDetail: (runId: string) =>
    spaceRequest<{ run: SpaceRun; actions: RunAction[]; approvals: RunApproval[] }>(`/runs/${part(runId)}`),
  decideRun: (runId: string, approved: boolean) =>
    spaceRequest<SpaceRun>(`/runs/${part(runId)}/approval`, { method: "POST", body: JSON.stringify({ approved }) }),
  cancelRun: (runId: string) => spaceRequest<SpaceRun>(`/runs/${part(runId)}/cancel`, { method: "POST" }),
  retryRun: (runId: string) => spaceRequest<SpaceRun>(`/runs/${part(runId)}/retry`, { method: "POST" }),
  workflowVersions: (spaceId: string, workflowId: string) =>
    spaceRequest<{ versions: WorkflowVersion[] }>(`/spaces/${part(spaceId)}/studio/workflows/${part(workflowId)}/versions`),
  createWorkflowVersion: (spaceId: string, workflowId: string, version: string, metadata: WorkflowMetadata, definition: Record<string, unknown>) =>
    spaceRequest<WorkflowVersion>(`/spaces/${part(spaceId)}/studio/workflows/${part(workflowId)}/versions`, { method: "POST", body: JSON.stringify({ version, metadata, definition }) }),
  replaceAgentWorkflow: (spaceId: string, agentId: string, workflowVersionId: string) =>
    spaceRequest<SpaceStudioResource>(`/spaces/${part(spaceId)}/studio/agents/${part(agentId)}/workflow`, { method: "PUT", body: JSON.stringify({ workflow_version_id: workflowVersionId }) }),
  conversations: () => spaceRequest<{ conversations: PrivateAgentConversation[] }>("/agent-conversations"),
  createConversation: (spaceId: string, agentId: string, title = "") =>
    spaceRequest<PrivateAgentConversation>("/agent-conversations", { method: "POST", body: JSON.stringify({ space_id: spaceId, agent_id: agentId, title }) }),
  conversationEvents: (conversationId: string) =>
    spaceRequest<{ events: PrivateConversationEvent[] }>(`/agent-conversations/${part(conversationId)}/events`),
  sendConversationMessage: (conversationId: string, input: AgentInvocationInput) =>
    spaceRequest<{ run?: SpaceRun; event?: PrivateConversationEvent; status?: string; routing?: RoutingDecision }>(`/agent-conversations/${part(conversationId)}/events`, { method: "POST", body: JSON.stringify(input) }),
  integrations: (spaceId: string) => spaceRequest<{ integrations: SpaceIntegration[] }>(`/spaces/${part(spaceId)}/integrations`),
  saveIntegration: (spaceId: string, integration: Partial<SpaceIntegration>) =>
    spaceRequest<SpaceIntegration>(`/spaces/${part(spaceId)}/integrations`, { method: "PUT", body: JSON.stringify(integration) }),
};
