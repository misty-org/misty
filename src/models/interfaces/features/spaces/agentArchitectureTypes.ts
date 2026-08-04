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

export interface AgentVersionWorkflow {
  workflow_version_id: string;
  alias: string;
  enabled: boolean;
  position: number;
}

export interface PublishedAgentVersion {
  id: string;
  agent_id: string;
  space_id: string;
  creator_user_id: string;
  version: number;
  name: string;
  description: string;
  icon: string;
  instructions: string;
  access: { mode: "space" | "selected"; allowedUserIds?: string[] };
  workflows: AgentVersionWorkflow[];
  checksum_sha256: string;
  published_at: string;
}

export interface AgentInstanceRecord {
  id: string;
  space_id: string;
  agent_id: string;
  user_id: string;
  agent_version_id: string;
  status: "idle" | "running";
  update_available: boolean;
  connection_bindings: Record<string, string>;
  capability_grants: AgentCapabilityGrant[];
  workflows: InstanceWorkflowConfig[];
  created_at: string;
  updated_at: string;
}

export interface AgentCapabilityGrant {
  capability: string;
  risk: "read" | "write" | "dangerous";
  scopes?: Record<string, string>;
}

export interface AgentToolboxAvailabilityReason {
  code: string;
  message: string;
}

export interface AgentToolboxAction {
  name: string;
  description: string;
  risk: "read" | "write" | "dangerous";
  approval: "none" | "explicit_intent" | "interactive";
  locality: "server" | "device" | "provider";
  idempotent: boolean;
  audit_event?: string;
  required_permission?: string;
  granted: boolean;
  available: boolean;
  reasons: AgentToolboxAvailabilityReason[];
}

export interface AgentToolboxActivity {
  tool_name: string;
  audit_event: string;
  risk: "write" | "dangerous";
  source: string;
  state: "started" | "completed" | "failed";
  error_code?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentToolboxResponse {
  actions: AgentToolboxAction[];
  recent_activity: AgentToolboxActivity[];
  instance?: AgentInstanceRecord;
  /** Public, effective context labels; private instructions are never included. */
  context?: string[];
}

export interface InstanceWorkflowConfig {
  workflow_version_id: string;
  enabled: boolean;
  trigger_config: Record<string, unknown>;
  consent: Record<string, unknown>;
  cursor: Record<string, unknown>;
  updated_at: string;
}

export interface SpaceRun {
  id: string;
  space_id: string;
  resource_kind: "agent" | "workflow";
  resource_id: string;
  initiated_by_user_id: string;
  billing_user_id: string;
  trigger_kind: string;
  state:
    | "queued"
    | "running"
    | "cooldown"
    | "awaiting_approval"
    | "completed"
    | "completed_with_errors"
    | "failed"
    | "canceled"
    | "rejected";
  agent_instance_id?: string;
  agent_version_id?: string;
  attempt?: number;
  next_retry_at?: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  error_code?: string;
  requesting_member_id: string;
  source_conversation_id?: string;
  source_task_id?: string;
  // "mika" is the pre-rename value, still present on rows created before
  // 20260916000000_rename_agent_run_source_type.sql and accepted by that
  // migration's CHECK during the transition. "connector" and "task" were always
  // valid server-side but were missing from this union.
  source_type:
    | "direct"
    | "group_mention"
    | "agent_console"
    | "studio_test"
    | "schedule"
    | "connector"
    | "task"
    | "mika";
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

export interface SpaceRunDetail {
  run: SpaceRun;
  actions: RunAction[];
  approvals: RunApproval[];
  steps: WorkflowRunStep[];
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

export interface WorkflowRunStep {
  ID: string;
  RunID: string;
  NodeID: string;
  State: string;
  Attempt: number;
  Input: Record<string, unknown>;
  Output: Record<string, unknown>;
  ErrorCode?: string;
  ErrorMessage?: string;
  StartedAt?: string;
  CompletedAt?: string;
  UpdatedAt: string;
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

export interface AgentDelegationResult {
  status: string;
  trace?: string;
  routing: RoutingDecision;
  run?: SpaceRun;
}

export interface AgentConversation {
  id: string;
  space_id: string;
  owner_user_id: string;
  agent_id: string;
  agent_name: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AgentConversationEvent {
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

export interface ProviderAuthorizationStart {
  provider: string;
  authorization_url: string;
  state_expires_at: string;
}

export interface ProviderConnectionAvailability {
  provider: string;
  configured: boolean;
}

export interface AvailableProviderResource {
  provider: "slack" | "discord" | "notion";
  resource_type: "channel" | "page" | "database" | "data_source";
  external_resource_id: string;
  display_name: string;
  configuration: Record<string, unknown>;
}

export interface ProviderSharedResource extends AvailableProviderResource {
  id: string;
  space_id: string;
  integration_id: string;
  published_by_user_id: string;
  permission_scope: string;
  status: "active" | "needs_attention" | "disabled";
  last_error_code?: string;
  created_at: string;
  updated_at: string;
}
