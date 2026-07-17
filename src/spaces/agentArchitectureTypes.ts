export interface WorkflowField {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
}

export interface WorkflowCapability {
  id: string;
  name: string;
  description: string;
  inputs: WorkflowField[];
  outputs: WorkflowField[];
  readOnly: boolean;
  destructive: boolean;
  confirmationRequired: boolean;
  tags: string[];
}

export interface WorkflowMetadata {
  capabilities: WorkflowCapability[];
  requiredIntegrations: string[];
  requiredPermissions: string[];
  runtime: { kind: string; compatibility: string };
  tags: string[];
}

export interface WorkflowVersion {
  id: string;
  workflow_id: string;
  space_id: string;
  stable_identifier: string;
  version: string;
  name: string;
  description: string;
  author_name: string;
  metadata: WorkflowMetadata;
  definition: Record<string, unknown>;
  checksum_sha256: string;
  created_by_user_id: string;
  created_at: string;
}

export interface SpaceRun {
  id: string;
  space_id: string;
  resource_kind: "agent" | "workflow";
  resource_id: string;
  initiated_by_user_id: string;
  billing_user_id: string;
  trigger_kind: string;
  state: "queued" | "running" | "awaiting_approval" | "retrying" | "completed" | "failed" | "canceled" | "rejected";
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  error_code?: string;
  requesting_member_id: string;
  source_conversation_id?: string;
  source_type: "direct" | "group_mention" | "mika" | "studio_test" | "schedule";
  agent_id?: string;
  workflow_identifier?: string;
  workflow_version_id?: string;
  workflow_version?: string;
  capability_id?: string;
  progress: number;
  outputs: Record<string, unknown>;
  artifacts: unknown[];
  error_message?: string;
  retry_of_run_id?: string;
  canceled_at?: string;
  updated_at: string;
  created_at: string;
  completed_at?: string;
}

export interface RunAction {
  id: string;
  run_id: string;
  action_kind: string;
  summary: string;
  details: Record<string, unknown>;
  destructive: boolean;
  state: string;
  performed_at?: string;
  created_at: string;
}

export interface RunApproval {
  id: string;
  run_id: string;
  requested_from_user_id: string;
  decided_by_user_id?: string;
  action_summary: string;
  proposed_actions: Array<Record<string, unknown>>;
  state: "pending" | "approved" | "rejected" | "expired" | "canceled";
  created_at: string;
  decided_at?: string;
  expires_at: string;
}

export interface AgentCatalogEntry {
  agent_id: string;
  agent_name: string;
  description: string;
  icon: string;
  status: string;
  runtime_kind: string;
  space_id: string;
  space_name: string;
  workflow: WorkflowVersion;
  capabilities: WorkflowCapability[];
}

export interface RoutingOption {
  space_id: string;
  space_name: string;
  agent_id: string;
  agent_name: string;
  capability_id: string;
  capability_name: string;
}

export interface RoutingDecision {
  needs_clarification: boolean;
  question?: string;
  options?: RoutingOption[];
  selected?: RoutingOption;
  reason?: string;
}

export interface MikaDelegationResult {
  status: string;
  trace?: string;
  routing: RoutingDecision;
  run?: SpaceRun;
}

export interface PrivateAgentConversation {
  id: string;
  space_id: string;
  owner_user_id: string;
  agent_id: string;
  agent_name: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface PrivateConversationEvent {
  id: number;
  conversation_id: string;
  user_id: string;
  event_type: "user_message" | "agent_message" | "run" | "error";
  data: Record<string, unknown>;
  created_at: string;
}

export interface SpaceIntegration {
  id: string;
  space_id: string;
  provider: string;
  display_name: string;
  credential_reference?: string;
  granted_permissions: string[];
  status: string;
  connected_by_user_id: string;
  created_at: string;
  updated_at: string;
}
