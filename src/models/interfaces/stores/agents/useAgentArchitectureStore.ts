import { spaceRequest } from "@/stores/spaces/useSpacesBackendStore";
import type {
  AgentCatalogEntry,
  AgentInstanceRecord,
  AgentVersionWorkflow,
  InstanceWorkflowConfig,
  MikaDelegationResult,
  AgentConversation,
  AgentConversationEvent,
  PublishedAgentVersion,
  RoutingDecision,
  RunAction,
  RunApproval,
  WorkflowRunStep,
  SpaceIntegration,
  SpaceRun,
  WorkflowMetadata,
  WorkflowVersion,
  ProviderAuthorizationStart,
  ProviderConnectionAvailability,
  AvailableProviderResource,
  ProviderSharedResource,
} from "@/models/interfaces/features/spaces/agentArchitectureTypes";
import type { Space, SpaceStudioResource } from "@/models/interfaces/features/spaces/types";

import type { AgentInvocationResult } from "@/models/types/stores/agents/useAgentArchitectureStore";

export interface AgentInvocationInput {
  prompt: string;
  capability_id?: string;
  source_conversation_id?: string;
  input?: Record<string, unknown>;
}
