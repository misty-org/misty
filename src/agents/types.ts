export type AgentRole = "owner" | "member";
export type AgentStatus = "draft" | "enabled" | "disabled";
export type AgentJobStatus =
  | "queued"
  | "leased"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";

export type AgentTriggerKind =
  | "manual"
  | "schedule"
  | "file_created"
  | "file_changed"
  | "local_webhook";

export type AgentActionKind =
  | "read"
  | "search"
  | "summarize"
  | "notify_local"
  | "create_file"
  | "overwrite"
  | "rename"
  | "move"
  | "delete"
  | "change_permissions"
  | "outbound_webhook"
  | "external_message";

export type AgentCitationKind = "pdf_page" | "slide" | "sheet_range" | "section" | "image";

export interface AgentScope {
  id: string;
  deviceId: string;
  displayName: string;
  kind: "local_folder";
  /** Relative paths may be shown locally. Absolute paths must never leave the device. */
  relativePath?: string | null;
  available: boolean;
}

export interface AgentMember {
  accountId: string;
  displayName: string;
  email?: string | null;
  role: AgentRole;
  status: "active" | "invited";
}

export interface AgentTrigger {
  id: string;
  kind: AgentTriggerKind;
  enabled: boolean;
  schedule?: string | null;
  webhookId?: string | null;
}

export interface AgentTrustPolicy {
  automaticActions: AgentActionKind[];
  approvalRequiredActions: AgentActionKind[];
  memberWriteAccess: false;
  approvalTtlHours: number;
}

export type AgentWorkflowNodeKind =
  | "manual_trigger"
  | "schedule_trigger"
  | "file_event"
  | "local_webhook"
  | "document_read"
  | "document_ocr"
  | "folder_query"
  | "mika_task"
  | "artifact_create"
  | "approval"
  | "reply";

export interface AgentWorkflowNode {
  id: string;
  kind: AgentWorkflowNodeKind;
  config: Record<string, unknown>;
  policy: Array<{ action: AgentActionKind; mode: "automatic" | "approval" }>;
}

export interface AgentWorkflow {
  version: 1;
  revision: number;
  nodes: AgentWorkflowNode[];
  edges: Array<{ from: string; to: string }>;
}

export interface AgentDefinition {
  id: string;
  ownerAccountId: string;
  deviceId: string;
  scope: AgentScope;
  name: string;
  instructions: string;
  status: AgentStatus;
  cloudDocumentConsent: boolean;
  members: AgentMember[];
  triggers: AgentTrigger[];
  trustPolicy: AgentTrustPolicy;
  workflow: AgentWorkflow;
  workflowId?: string | null;
  workflowRevision: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCitation {
  id: string;
  artifactId?: string | null;
  scopeId: string;
  fileName: string;
  relativePath?: string | null;
  kind: AgentCitationKind;
  label: string;
  page?: number | null;
  slide?: number | null;
  sheet?: string | null;
  range?: string | null;
  section?: string | null;
  excerpt?: string | null;
}

export interface PreparedDocumentSection {
  kind: "page" | "slide" | "sheet" | "section" | "lines" | "image";
  locator: string;
  text: string;
  imageDataUrl?: string | null;
  requiresOcr: boolean;
}

export interface PreparedAgentDocument {
  documentId: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  sections: PreparedDocumentSection[];
  truncated: boolean;
  requiresOcr: boolean;
}

export interface AgentArtifact {
  id: string;
  jobId: string;
  agentId: string;
  scopeId: string;
  fileName: string;
  relativePath?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt: string;
  citations: AgentCitation[];
}

export interface AgentJobEvent {
  id: string;
  jobId: string;
  sequence: number;
  type: "status" | "progress" | "message" | "artifact" | "error";
  message: string;
  progress?: number | null;
  createdAt: string;
}

export interface AgentJob {
  id: string;
  agentId: string;
  deviceId: string;
  requesterAccountId: string;
  triggerKind: AgentTriggerKind;
  status: AgentJobStatus;
  prompt?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  leaseExpiresAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  progress?: number | null;
  statusMessage?: string | null;
  error?: string | null;
  creditsUsed?: number | null;
  result?: {
    answer: string;
    citations: AgentCitation[];
    creditsUsed?: number | null;
  } | null;
  events: AgentJobEvent[];
  artifactIds: string[];
}

export interface AgentApprovalAction {
  kind: AgentActionKind;
  summary: string;
  scopeId: string;
  relativePaths: string[];
  destinationRelativePath?: string | null;
  contentSha256?: string | null;
  unixMode?: number | null;
  digest: string;
}

export interface AgentApproval {
  id: string;
  agentId: string;
  jobId: string;
  requestedByAccountId: string;
  status: "pending" | "approved" | "denied" | "expired";
  action: AgentApprovalAction;
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string | null;
  resolvedByAccountId?: string | null;
}

export interface AgentDevice {
  id: string;
  displayName: string;
  status: "online" | "offline" | "revoked";
  capabilities: string[];
  lastSeenAt?: string | null;
}

export interface AgentSnapshot {
  version: 1;
  localWebhookUrl?: string | null;
  device: AgentDevice | null;
  scopes: AgentScope[];
  definitions: AgentDefinition[];
  jobs: AgentJob[];
  approvals: AgentApproval[];
  artifacts: AgentArtifact[];
  loadedAt: string;
}

export interface AgentDraft {
  localPath: string;
  displayName: string;
}

export const defaultAgentTrustPolicy = (): AgentTrustPolicy => ({
  automaticActions: ["read", "search", "summarize", "notify_local", "create_file"],
  approvalRequiredActions: [
    "overwrite",
    "rename",
    "move",
    "delete",
    "change_permissions",
    "outbound_webhook",
    "external_message",
  ],
  memberWriteAccess: false,
  approvalTtlHours: 24,
});

export const emptyAgentSnapshot = (): AgentSnapshot => ({
  version: 1,
  device: null,
  scopes: [],
  definitions: [],
  jobs: [],
  approvals: [],
  artifacts: [],
  loadedAt: new Date(0).toISOString(),
});
