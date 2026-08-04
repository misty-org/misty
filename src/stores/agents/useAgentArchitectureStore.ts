import type { AgentInvocationResult } from "@/models/types/stores/agents/useAgentArchitectureStore";
export type { AgentInvocationResult } from "@/models/types/stores/agents/useAgentArchitectureStore";
import type { AgentInvocationInput } from "@/models/interfaces/stores/agents/useAgentArchitectureStore";
export type { AgentInvocationInput } from "@/models/interfaces/stores/agents/useAgentArchitectureStore";
import { spaceRequest } from "@/stores/spaces/useSpacesBackendStore";
import type {
  AgentCatalogEntry,
  AgentCapabilityGrant,
  AgentToolboxResponse,
  AgentInstanceRecord,
  AgentVersionWorkflow,
  InstanceWorkflowConfig,
  AgentDelegationResult,
  AgentConversation,
  AgentConversationEvent,
  PublishedAgentVersion,
  RoutingDecision,
  SpaceIntegration,
  SpaceRun,
  SpaceRunDetail,
  WorkflowMetadata,
  WorkflowVersion,
  ProviderAuthorizationStart,
  ProviderConnectionAvailability,
  AvailableProviderResource,
  ProviderSharedResource,
} from "@/models/interfaces/features/spaces/agentArchitectureTypes";
import type { Space, SpaceStudioResource } from "@/models/interfaces/features/spaces/types";

const part = encodeURIComponent;

export const agentArchitectureApi = {
  catalog: () => spaceRequest<{ agents: AgentCatalogEntry[] }>("/agents/catalog"),
  discovery: () =>
    spaceRequest<{ spaces: Space[]; agents: AgentCatalogEntry[] }>("/agents/discovery"),
  delegate: (input: AgentInvocationInput & { space_id?: string; agent_id?: string }) =>
    spaceRequest<AgentDelegationResult>("/agents/delegations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  runs: (spaceId: string, agentId: string) =>
    spaceRequest<{ runs: SpaceRun[] }>(`/spaces/${part(spaceId)}/agents/${part(agentId)}/runs`),
  run: (spaceId: string, agentId: string, input: AgentInvocationInput) =>
    spaceRequest<AgentInvocationResult>(`/spaces/${part(spaceId)}/agents/${part(agentId)}/runs`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  runDetail: (runId: string) => spaceRequest<SpaceRunDetail>(`/runs/${part(runId)}`),
  decideRun: (runId: string, approved: boolean) =>
    spaceRequest<SpaceRun>(`/runs/${part(runId)}/approval`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),
  cancelRun: (runId: string) =>
    spaceRequest<SpaceRun>(`/runs/${part(runId)}/cancel`, { method: "POST" }),
  retryRun: (runId: string) =>
    spaceRequest<SpaceRun>(`/runs/${part(runId)}/retry`, { method: "POST" }),
  workflowVersions: (spaceId: string, workflowId: string) =>
    spaceRequest<{ versions: WorkflowVersion[] }>(
      `/spaces/${part(spaceId)}/studio/workflows/${part(workflowId)}/versions`,
    ),
  createWorkflowVersion: (
    spaceId: string,
    workflowId: string,
    version: string,
    metadata: WorkflowMetadata,
    definition: Record<string, unknown>,
  ) =>
    spaceRequest<WorkflowVersion>(
      `/spaces/${part(spaceId)}/studio/workflows/${part(workflowId)}/versions`,
      { method: "POST", body: JSON.stringify({ version, metadata, definition }) },
    ),
  agentVersions: (spaceId: string, agentId: string) =>
    spaceRequest<{ versions: PublishedAgentVersion[] }>(
      `/spaces/${part(spaceId)}/studio/agents/${part(agentId)}/versions`,
    ),
  publishAgentVersion: (spaceId: string, agentId: string, workflows: AgentVersionWorkflow[]) =>
    spaceRequest<PublishedAgentVersion>(
      `/spaces/${part(spaceId)}/studio/agents/${part(agentId)}/versions`,
      { method: "POST", body: JSON.stringify({ workflows }) },
    ),
  agentInstance: (spaceId: string, agentId: string) =>
    spaceRequest<AgentInstanceRecord>(`/spaces/${part(spaceId)}/agents/${part(agentId)}/instance`),
  updateAgentInstance: (spaceId: string, agentId: string) =>
    spaceRequest<AgentInstanceRecord>(`/spaces/${part(spaceId)}/agents/${part(agentId)}/instance`, {
      method: "POST",
    }),
  configureInstanceWorkflow: (
    instanceId: string,
    workflowVersionId: string,
    input: {
      enabled: boolean;
      trigger_config?: Record<string, unknown>;
      consent?: Record<string, unknown>;
    },
  ) =>
    spaceRequest<InstanceWorkflowConfig>(
      `/agent-instances/${part(instanceId)}/workflows/${part(workflowVersionId)}`,
      { method: "PUT", body: JSON.stringify(input) },
    ),
  updateInstanceConnections: (instanceId: string, bindings: Record<string, string>) =>
    spaceRequest<AgentInstanceRecord>(`/agent-instances/${part(instanceId)}/connections`, {
      method: "PUT",
      body: JSON.stringify({ bindings }),
    }),
  updateInstanceCapabilities: (instanceId: string, grants: AgentCapabilityGrant[]) =>
    spaceRequest<AgentInstanceRecord>(`/agent-instances/${part(instanceId)}/capabilities`, {
      method: "PUT",
      body: JSON.stringify({ grants }),
    }),
  instanceToolbox: (instanceId: string) =>
    spaceRequest<AgentToolboxResponse>(`/agent-instances/${part(instanceId)}/toolbox`),
  conversations: () => spaceRequest<{ conversations: AgentConversation[] }>("/agent-conversations"),
  createConversation: (spaceId: string, agentId: string, title = "") =>
    spaceRequest<AgentConversation>("/agent-conversations", {
      method: "POST",
      body: JSON.stringify({ space_id: spaceId, agent_id: agentId, title }),
    }),
  conversationEvents: (conversationId: string) =>
    spaceRequest<{ events: AgentConversationEvent[] }>(
      `/agent-conversations/${part(conversationId)}/events`,
    ),
  sendConversationMessage: (conversationId: string, input: AgentInvocationInput) =>
    spaceRequest<{
      run?: SpaceRun;
      event?: AgentConversationEvent;
      status?: string;
      routing?: RoutingDecision;
    }>(`/agent-conversations/${part(conversationId)}/events`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  integrations: (spaceId: string) =>
    spaceRequest<{
      integrations: SpaceIntegration[];
      providers?: ProviderConnectionAvailability[];
    }>(`/spaces/${part(spaceId)}/integrations`),
  beginProviderConnection: (spaceId: string, provider: string, returnTo: string) =>
    spaceRequest<ProviderAuthorizationStart>(
      `/spaces/${part(spaceId)}/integrations/${part(provider)}/authorize`,
      { method: "POST", body: JSON.stringify({ return_to: returnTo }) },
    ),
  deleteIntegration: (integrationId: string) =>
    spaceRequest<void>(`/integrations/${part(integrationId)}`, { method: "DELETE" }),
  availableProviderResources: (spaceId: string, integrationId: string) =>
    spaceRequest<{ resources: AvailableProviderResource[] }>(
      `/spaces/${part(spaceId)}/integrations/${part(integrationId)}/resources`,
    ),
  sharedProviderResources: (spaceId: string) =>
    spaceRequest<{ resources: ProviderSharedResource[] }>(
      `/spaces/${part(spaceId)}/provider-resources`,
    ),
  publishProviderResource: (
    spaceId: string,
    integrationId: string,
    resource: AvailableProviderResource,
  ) =>
    spaceRequest<ProviderSharedResource>(`/spaces/${part(spaceId)}/provider-resources`, {
      method: "POST",
      body: JSON.stringify({ integration_id: integrationId, ...resource }),
    }),
  disableProviderResource: (spaceId: string, resourceId: string) =>
    spaceRequest<void>(`/spaces/${part(spaceId)}/provider-resources/${part(resourceId)}`, {
      method: "DELETE",
    }),
};
