import { spaceRequest } from "@/stores/spaces/useSpacesBackendStore";
import type {
  AgentCatalogEntry,
  AgentInstanceRecord,
  AgentVersionWorkflow,
  InstanceWorkflowConfig,
  AgentDelegationResult,
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

import type { AgentInvocationInput } from "@/models/interfaces/stores/agents/useAgentArchitectureStore";

export type AgentInvocationResult =
  | SpaceRun
  | AgentDelegationResult
  | {
      status: "needs_clarification";
      routing: RoutingDecision;
    };
