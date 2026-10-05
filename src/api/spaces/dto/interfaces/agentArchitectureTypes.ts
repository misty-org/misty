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
  source_type:
    | "direct"
    | "group_mention"
    | "agent_console"
    | "studio_test"
    | "schedule"
    | "connector"
    | "task";
  agent_id?: string;
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
