import { invoke } from "@tauri-apps/api/core";
import { ManagedAiRequestError, managedAiRequest } from "../stores/aiServerApi";
import type {
  AgentApproval,
  AgentApprovalAction,
  AgentCitation,
  AgentDefinition,
  AgentDevice,
  AgentJob,
  PreparedAgentDocument,
  AgentSnapshot,
  AgentScope,
  AgentTrigger,
} from "./types";
import { ensureServerAgentDevice } from "./deviceApi";

export interface RegisterFolderScopeRequest {
  path: string;
}

export interface SaveAgentDefinitionRequest {
  definition: AgentDefinition;
}

export interface DeleteAgentDefinitionRequest {
  agentId: string;
}

export interface ClaimAgentJobsRequest {
  limit: number;
  leaseSeconds: number;
}

export interface AgentJobLeaseRequest {
  jobId: string;
  leaseSeconds: number;
  progress?: number | null;
  statusMessage?: string | null;
}

export interface CompleteAgentJobRequest {
  jobId: string;
  idempotencyKey: string;
  artifactIds: string[];
  statusMessage?: string | null;
}

export interface FailAgentJobRequest {
  jobId: string;
  idempotencyKey: string;
  error: string;
  retryable: boolean;
}

export interface CancelAgentJobRequest {
  jobId: string;
}

export interface ResolveAgentApprovalRequest {
  approvalId: string;
  decision: "approved" | "denied";
  actionDigest: string;
}

export interface OpenAgentCitationRequest {
  citation: AgentCitation;
}

export interface PrepareAgentDocumentRequest {
  path: string;
}

export interface PrepareScopedAgentDocumentRequest {
  scopeId: string;
  relativePath: string;
  ocrPageStart?: number;
  ocrPageLimit?: number;
}

export interface ReconciledAgentFileEvent {
  eventId: string;
  agentId: string;
  scopeId: string;
  triggerKind: "file_created" | "file_changed" | "local_webhook";
  fileName?: string;
  prompt?: string;
  checkpoint: string;
}

export interface ReconciledAgentScopes {
  events: ReconciledAgentFileEvent[];
  truncatedScopes: string[];
  reconciledAt: string;
}

export interface ExecuteApprovedAgentActionRequest {
  agentId: string;
  jobId: string;
  actionDigest: string;
  kind: "overwrite" | "rename" | "move" | "delete" | "change_permissions";
  summary: string;
  scopeId: string;
  relativePaths: string[];
  destinationRelativePath?: string;
  content?: string;
  contentSha256?: string;
  unixMode?: number;
}

export interface StageApprovedAgentActionRequest extends ExecuteApprovedAgentActionRequest {
  result: { answer: string; citations: AgentCitation[]; creditsUsed: number };
}

export async function agentsSnapshot(): Promise<AgentSnapshot> {
  return invoke<AgentSnapshot>("agents_snapshot");
}

export async function agentsRegisterFolderScope(request: RegisterFolderScopeRequest): Promise<AgentScope> {
  return invoke<AgentScope>("agents_register_folder_scope", { request });
}

export async function agentsSaveDefinition(request: SaveAgentDefinitionRequest): Promise<AgentDefinition> {
  return invoke<AgentDefinition>("agents_save_definition", { request });
}

export async function agentsDeleteDefinition(request: DeleteAgentDefinitionRequest): Promise<void> {
  await invoke("agents_delete_definition", { request });
}

export async function agentsClaimJobs(request: ClaimAgentJobsRequest): Promise<AgentJob[]> {
  return invoke<AgentJob[]>("agents_claim_jobs", { request });
}

export async function agentsHeartbeatJob(request: AgentJobLeaseRequest): Promise<AgentJob> {
  return invoke<AgentJob>("agents_heartbeat_job", { request });
}

export async function agentsCompleteJob(request: CompleteAgentJobRequest): Promise<AgentJob> {
  return invoke<AgentJob>("agents_complete_job", { request });
}

export async function agentsFailJob(request: FailAgentJobRequest): Promise<AgentJob> {
  return invoke<AgentJob>("agents_fail_job", { request });
}

export async function agentsCancelJob(request: CancelAgentJobRequest): Promise<AgentJob> {
  return invoke<AgentJob>("agents_cancel_job", { request });
}

export async function agentsResolveApproval(request: ResolveAgentApprovalRequest): Promise<AgentApproval> {
  return invoke<AgentApproval>("agents_resolve_approval", { request });
}

export async function agentsOpenCitation(request: OpenAgentCitationRequest): Promise<void> {
  await invoke("agents_open_citation", { request });
}

export async function agentsPrepareDocument(request: PrepareAgentDocumentRequest): Promise<PreparedAgentDocument> {
  return invoke<PreparedAgentDocument>("agents_prepare_document", { request });
}

export async function agentsPrepareScopedDocument(request: PrepareScopedAgentDocumentRequest): Promise<PreparedAgentDocument> {
  return invoke<PreparedAgentDocument>("agents_prepare_scoped_document", { request });
}

export async function agentsFindScopeDocument(request: { scopeId: string; query: string }): Promise<string | null> {
  return invoke<string | null>("agents_find_scope_document", { request });
}

export async function agentsReconcileScopes(): Promise<ReconciledAgentScopes> {
  return invoke<ReconciledAgentScopes>("agents_reconcile_scopes", {
    request: { maxFilesPerScope: 5000, maxEvents: 100 },
  });
}

export async function agentsAcknowledgeFileEvents(eventIds: string[]): Promise<void> {
  await invoke("agents_acknowledge_file_events", { request: { eventIds } });
}

export async function agentsCreateSummaryArtifact(request: {
  agentId: string;
  jobId: string;
  scopeId: string;
  sourceFileName: string;
  content: string;
}): Promise<{ id: string; fileName: string; relativePath: string; scopeId: string }> {
  return invoke("agents_create_summary_artifact", { request });
}

export async function agentsExecuteApprovedAction(request: ExecuteApprovedAgentActionRequest): Promise<{
  jobId: string;
  actionDigest: string;
  status: "completed";
  result?: { answer?: string; citations?: AgentCitation[]; creditsUsed?: number } | null;
}> {
  return invoke("agents_execute_approved_action", { request });
}

export async function agentsStageApprovedAction(request: StageApprovedAgentActionRequest): Promise<{ actionDigest: string; status: "pending" }> {
  return invoke("agents_stage_approved_action", { request });
}

export async function fetchServerAgentSnapshot(): Promise<AgentSnapshot> {
  try {
    const snapshot = await managedAiRequest<AgentSnapshot>("/agents/snapshot");
    if (!snapshot.jobs.some((job) => job.status === "completed" && !job.result)) return snapshot;
    // Older beta servers retained the result but omitted it from the combined
    // snapshot. Hydrate those rows from the job-history endpoint so completed
    // answers remain visible during rolling upgrades.
    const history = await managedAiRequest<{ jobs: ServerAgentJob[] }>("/agents/jobs?limit=100").catch(() => null);
    if (!history) return snapshot;
    const hydrated = new Map(history.jobs.map((job) => {
      const normalized = normalizeServerJob(job);
      return [normalized.id, normalized];
    }));
    return {
      ...snapshot,
      jobs: snapshot.jobs.map((job) => {
        const complete = hydrated.get(job.id);
        return complete ? {
          ...job,
          result: complete.result ?? job.result,
          creditsUsed: complete.creditsUsed ?? job.creditsUsed,
        } : job;
      }),
    };
  } catch (error) {
    if (!(error instanceof ManagedAiRequestError) || error.status !== 404) throw error;
  }
  const [agentResponse, jobResponse, deviceResponse] = await Promise.all([
    managedAiRequest<{ agents: ServerAgentDefinition[] }>("/agents"),
    managedAiRequest<{ jobs: ServerAgentJob[] }>("/agents/jobs?limit=100"),
    managedAiRequest<{ devices: ServerAgentDevice[] }>("/devices"),
  ]);
  const supporting = await Promise.all(agentResponse.agents.map(async (agent) => {
    const [members, triggers] = await Promise.all([
      managedAiRequest<{ members: ServerAgentMember[] }>(`/agents/${encodeURIComponent(agent.id)}/members`).catch(() => ({ members: [] })),
      managedAiRequest<{ triggers: ServerAgentTrigger[] }>(`/agents/${encodeURIComponent(agent.id)}/triggers`).catch(() => ({ triggers: [] })),
    ]);
    return { agent, members: members.members, triggers: triggers.triggers };
  }));
  const definitions = supporting.map(({ agent, members, triggers }) => normalizeServerDefinition(agent, members, triggers));
  const devices = deviceResponse.devices.map(normalizeServerDevice);
  return {
    version: 1,
    device: devices.find((device) => device.status !== "revoked") ?? devices[0] ?? null,
    scopes: definitions.map((definition) => definition.scope),
    definitions,
    jobs: jobResponse.jobs.map(normalizeServerJob),
    approvals: [],
    artifacts: [],
    loadedAt: new Date().toISOString(),
  };
}

export async function saveServerAgentDefinition(definition: AgentDefinition): Promise<AgentDefinition> {
  const serverDevice = await ensureServerAgentDevice({
    id: definition.deviceId,
    displayName: "This Misty",
    status: "online",
    capabilities: ["folder_agents", "document_intelligence", "job_leases", "citations"],
  });
  const body = {
    id: definition.id,
    spaceId: definition.spaceId,
    deviceId: serverDevice.id,
    scopeId: definition.scope.id,
    name: definition.name,
    instructions: definition.instructions,
    workflow: { ...definition.workflow, workflowId: definition.workflowId },
    workflowRevision: definition.workflowRevision,
    trustPolicy: definition.trustPolicy,
    cloudDocumentConsent: definition.cloudDocumentConsent,
    enabled: definition.status === "enabled",
    version: definition.version,
  };
  let saved: ServerAgentDefinition;
  try {
    // Server existence, rather than local draft/version state, is authoritative.
    // Drafts remain version 1 while being edited, so POST-on-version would try
    // to recreate an existing row every time the workflow editor saves.
    saved = await managedAiRequest<ServerAgentDefinition>(`/agents/${encodeURIComponent(definition.id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (!(error instanceof ManagedAiRequestError) || error.status !== 404) throw error;
    saved = await managedAiRequest<ServerAgentDefinition>("/agents", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  await managedAiRequest(`/agents/${encodeURIComponent(saved.id)}/triggers`, {
    method: "PUT",
    body: JSON.stringify({
      triggers: definition.triggers.map((trigger) => ({
        kind: trigger.kind,
        enabled: trigger.enabled,
        config: {
          schedule: trigger.schedule ?? undefined,
          webhookId: trigger.webhookId ?? undefined,
        },
      })),
    }),
  });
  return {
    ...definition,
    ...normalizeServerDefinition(saved, [], definition.triggers.map((trigger) => ({
      id: trigger.id,
      kind: trigger.kind,
      enabled: trigger.enabled,
      config: { schedule: trigger.schedule, webhookId: trigger.webhookId },
    }))),
    scope: definition.scope,
    deviceId: definition.deviceId,
    members: definition.members,
    triggers: definition.triggers,
  };
}

export async function deleteServerAgentDefinition(agentId: string): Promise<void> {
  await managedAiRequest(`/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" });
}

export async function resolveServerAgentApproval(
  approvalId: string,
  decision: "approved" | "denied",
  actionDigest: string,
): Promise<AgentApproval> {
  const approval = await managedAiRequest<ServerAgentApproval>(`/agents/approvals/${encodeURIComponent(approvalId)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision: decision === "approved" ? "approve" : "reject", actionDigest }),
  });
  return normalizeServerApproval(approval);
}

export async function cancelServerAgentJob(jobId: string): Promise<AgentJob> {
  const job = await managedAiRequest<ServerAgentJob>(`/agents/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  return normalizeServerJob(job);
}

export async function retryServerAgentJob(jobId: string): Promise<AgentJob> {
  const job = await managedAiRequest<ServerAgentJob>(`/agents/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
  return normalizeServerJob(job);
}

interface ServerAgentDefinition {
  id: string;
  spaceId: string;
  ownerUserId: string;
  deviceId: string;
  scopeId: string;
  name: string;
  instructions: string;
  workflow?: (AgentDefinition["workflow"] & { workflowId?: string | null }) | null;
  trustPolicy?: AgentDefinition["trustPolicy"] | null;
  workflowRevision: number;
  version: number;
  cloudDocumentConsent: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ServerAgentMember { userId: string; role: "owner" | "member"; }
interface ServerAgentTrigger {
  id: string;
  kind: AgentTrigger["kind"];
  enabled: boolean;
  config?: { schedule?: string | null; webhookId?: string | null } | null;
}
interface ServerAgentJob {
  id: string;
  agentId?: string | null;
  ownerUserId: string;
  requesterUserId: string;
  deviceId: string;
  triggerKind: AgentJob["triggerKind"];
  state: AgentJob["status"];
  payload?: { prompt?: string | null } | null;
  result?: {
    answer?: string | null;
    citations?: AgentCitation[] | null;
    creditsUsed?: number | null;
  } | null;
  errorMessage?: string | null;
  progress?: number | null;
  leaseExpiresAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}
interface ServerAgentApproval {
  id: string;
  jobId: string;
  agentId?: string | null;
  action?: AgentApprovalAction | null;
  actionKind?: AgentApproval["action"]["kind"];
  actionSummary?: string;
  actionDigest?: string;
  state: string;
  expiresAt: string;
  createdAt: string;
  decidedAt?: string | null;
}
interface ServerAgentDevice {
  id: string;
  name: string;
  capabilities?: Record<string, unknown> | string[] | null;
  lastSeenAt?: string | null;
  revokedAt?: string | null;
}

function normalizeServerDefinition(
  definition: ServerAgentDefinition,
  members: ServerAgentMember[],
  triggers: ServerAgentTrigger[],
): AgentDefinition {
  return {
    id: definition.id,
    spaceId: definition.spaceId,
    ownerAccountId: definition.ownerUserId,
    deviceId: definition.deviceId,
    scope: { id: definition.scopeId, deviceId: definition.deviceId, displayName: "Folder", kind: "local_folder", relativePath: null, available: true },
    name: definition.name,
    instructions: definition.instructions,
    status: definition.enabled ? "enabled" : definition.version > 1 ? "disabled" : "draft",
    cloudDocumentConsent: definition.cloudDocumentConsent,
    members: [
      { accountId: definition.ownerUserId, displayName: "Owner", role: "owner", status: "active" },
      ...members.filter((member) => member.userId !== definition.ownerUserId).map((member) => ({ accountId: member.userId, displayName: member.userId, role: "member" as const, status: "active" as const })),
    ],
    triggers: triggers.map((trigger) => ({
      id: trigger.id,
      kind: trigger.kind,
      enabled: trigger.enabled,
      schedule: trigger.config?.schedule ?? null,
      webhookId: trigger.config?.webhookId ?? null,
    })),
    trustPolicy: definition.trustPolicy ?? {
      automaticActions: ["read", "search", "summarize", "notify_local", "create_file"],
      approvalRequiredActions: ["overwrite", "rename", "move", "delete", "change_permissions", "outbound_webhook", "external_message"],
      memberWriteAccess: false,
      approvalTtlHours: 24,
    },
    workflow: definition.workflow ?? { version: 1, revision: definition.workflowRevision, nodes: [], edges: [] },
    workflowId: definition.workflow?.workflowId ?? null,
    workflowRevision: definition.workflowRevision,
    version: definition.version,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

function normalizeServerJob(job: ServerAgentJob): AgentJob {
  const result = job.result?.answer ? {
    answer: job.result.answer,
    citations: job.result.citations ?? [],
    creditsUsed: job.result.creditsUsed ?? null,
  } : null;
  return {
    id: job.id,
    agentId: job.agentId ?? "",
    deviceId: job.deviceId,
    requesterAccountId: job.requesterUserId,
    triggerKind: job.triggerKind,
    status: job.state,
    prompt: job.payload?.prompt ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    leaseExpiresAt: job.leaseExpiresAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    progress: typeof job.progress === "number" ? job.progress / 100 : null,
    creditsUsed: result?.creditsUsed ?? null,
    result,
    error: job.errorMessage,
    events: [],
    artifactIds: [],
  };
}

function normalizeServerApproval(approval: ServerAgentApproval): AgentApproval {
  const action = approval.action ?? {
    kind: approval.actionKind ?? "read",
    summary: approval.actionSummary ?? "Review this action",
    scopeId: "",
    relativePaths: [],
    digest: approval.actionDigest ?? "",
  };
  return {
    id: approval.id,
    agentId: approval.agentId ?? "",
    jobId: approval.jobId,
    requestedByAccountId: "",
    status: approval.state === "approved" ? "approved" : approval.state === "rejected" ? "denied" : approval.state as AgentApproval["status"],
    action,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
    resolvedAt: approval.decidedAt,
  };
}

function normalizeServerDevice(device: ServerAgentDevice): AgentDevice {
  const capabilities = Array.isArray(device.capabilities)
    ? device.capabilities
    : Object.entries(device.capabilities ?? {}).filter(([, enabled]) => Boolean(enabled)).map(([name]) => name);
  return {
    id: device.id,
    displayName: device.name,
    status: device.revokedAt ? "revoked" : device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 120_000 ? "online" : "offline",
    capabilities,
    lastSeenAt: device.lastSeenAt,
  };
}
