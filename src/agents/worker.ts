import {
  cancelAgentSession,
  createAgentSession,
  fetchAgentEvents,
	ManagedAiRequestError,
  managedAiRequest,
  sendAgentMessage,
  submitToolResults,
  type AgentEvent,
  type ToolResult,
} from "../stores/aiServerApi";
import {
  agentsAcknowledgeFileEvents,
  agentsCreateSummaryArtifact,
  agentsExecuteApprovedAction,
  agentsFindScopeDocument,
  agentsPrepareScopedDocument,
  agentsReconcileScopes,
  agentsSnapshot,
  agentsStageApprovedAction,
  type ReconciledAgentFileEvent,
} from "./api";
import { ensureServerAgentDevice, heartbeatServerAgentDevice, signedAgentDeviceRequest } from "./deviceApi";
import { mistyDeviceJobsEnabled, mistyDocumentsEnabled, mistyFolderAgentsEnabled } from "./flags";
import type { AgentApproval, AgentCitation, AgentDevice, AgentWorkflow } from "./types";
import { planAgentWorkflow, plannedMutation, type PlannedMutationAction, type WorkflowPlan } from "./workflow";
import { forgetJobAttachmentEnvelope, preparedDocumentBatch, uploadPreparedDocumentBatch } from "./attachments";

const leaseHeartbeatMs = 25_000;
const activePollMs = 750;
const idlePollMs = 4_000;
const hiddenPollMs = 15_000;
const maxJobRuntimeMs = 10 * 60_000;

export interface ClaimedAgentJob {
  job: {
    id: string;
    agentId: string;
    deviceId: string;
    ownerUserId?: string;
    requesterUserId?: string;
    triggerKind: string;
    state: string;
    payload: unknown;
    expiresAt: string;
  };
  leaseToken: string;
  leaseExpiresAt?: string | null;
}

export interface AgentJobResult {
  answer: string;
  citations: AgentCitation[];
  creditsUsed: number;
}

interface ServerAgentDefinition {
  id: string;
  scopeId: string;
  name: string;
  instructions: string;
  cloudDocumentConsent?: boolean;
  ownerUserId?: string;
  trustPolicy?: { automaticActions?: string[] };
  workflow?: AgentWorkflow;
}

class AwaitingApprovalError extends Error {}

export interface AgentWorkerDependencies {
  request: typeof managedAiRequest;
  now: () => number;
  wait: (milliseconds: number) => Promise<void>;
  execute: (claim: ClaimedAgentJob, definition: ServerAgentDefinition, signal: AbortSignal) => Promise<AgentJobResult>;
}

const defaultDependencies: AgentWorkerDependencies = {
  request: managedAiRequest,
  now: Date.now,
  wait: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
  execute: executeManagedMikaJob,
};

export class DesktopAgentJobWorker {
  private stopped = true;
  private serverDeviceId: string | null = null;
  private abortController: AbortController | null = null;

  constructor(private readonly dependencies: AgentWorkerDependencies = defaultDependencies) {}

  start(): void {
    if (!this.stopped || !mistyDeviceJobsEnabled()) return;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
    this.abortController = null;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let waitMs = document.visibilityState === "hidden" ? hiddenPollMs : idlePollMs;
      try {
        const localDevice = await loadLocalAgentDevice();
        const serverDevice = await ensureServerAgentDevice(localDevice);
        this.serverDeviceId = serverDevice.id;
        if (mistyFolderAgentsEnabled()) await enqueueReconciledFileEvents(this.dependencies.request);
        const claim = await claimNextJob(serverDevice.id, localDevice.id);
        if (claim) {
          waitMs = activePollMs;
          await this.runClaim(claim);
        }
      } catch {
        // Offline and signed-out states are normal. Durable jobs remain queued
        // server-side and are claimed after the next successful heartbeat.
        waitMs = hiddenPollMs;
      }
      if (!this.stopped) await this.dependencies.wait(waitMs);
    }
  }

  private async runClaim(claim: ClaimedAgentJob): Promise<void> {
    const deviceId = this.serverDeviceId;
    if (!deviceId) return;
    const controller = new AbortController();
    this.abortController = controller;
    const base = `/devices/${encodeURIComponent(deviceId)}/jobs/${encodeURIComponent(claim.job.id)}`;
    let heartbeat: number | null = null;
    try {
      await leaseAction(deviceId, `${base}/start`, claim.leaseToken, {});
      heartbeat = window.setInterval(() => {
        void leaseAction(deviceId, `${base}/lease`, claim.leaseToken, {})
          .then(() => heartbeatServerAgentDevice(deviceId))
          .catch(() => controller.abort());
      }, leaseHeartbeatMs);

      const definition = await this.dependencies.request<ServerAgentDefinition>(`/agents/${encodeURIComponent(claim.job.agentId)}`);
      const result = await this.dependencies.execute(claim, definition, controller.signal);
      if (controller.signal.aborted) throw new Error("The job lease was canceled or expired.");
      const artifact = await maybeCreateAutomaticSummaryArtifact(claim, definition, result.answer);
      await leaseAction(deviceId, `${base}/progress`, claim.leaseToken, { progress: 95 });
      const completion = completionPayload(result);
      if (artifact) completion.artifact = { scopeId: artifact.scopeId, fileName: artifact.fileName, relativePath: artifact.relativePath };
      await leaseAction(deviceId, `${base}/complete`, claim.leaseToken, {
        result: completion,
      });
    } catch (error) {
      if (!(error instanceof AwaitingApprovalError) && !controller.signal.aborted) {
        await leaseAction(deviceId, `${base}/fail`, claim.leaseToken, {
          errorCode: "device_execution_failed",
          errorMessage: safeErrorMessage(error),
        }).catch(() => undefined);
      }
    } finally {
      if (heartbeat !== null) window.clearInterval(heartbeat);
      this.abortController = null;
    }
  }
}

async function enqueueReconciledFileEvents(request: typeof managedAiRequest): Promise<void> {
  const reconciliation = await agentsReconcileScopes();
  const acknowledged: string[] = [];
  for (const event of reconciliation.events) {
    try {
      await enqueueFileEvent(request, event);
      acknowledged.push(event.eventId);
    } catch {
      // The device SQLite outbox retains failed deliveries for the next pass.
    }
  }
  if (acknowledged.length) await agentsAcknowledgeFileEvents(acknowledged);
}

async function enqueueFileEvent(request: typeof managedAiRequest, event: ReconciledAgentFileEvent): Promise<void> {
  await request(`/agents/${encodeURIComponent(event.agentId)}/jobs`, {
    method: "POST",
    body: JSON.stringify({
      triggerKind: event.triggerKind,
      idempotencyKey: event.eventId,
      payload: {
        scopeId: event.scopeId,
        ...(event.fileName ? { fileName: event.fileName } : {}),
        prompt: event.prompt || `${event.triggerKind === "file_created" ? "A new file was added" : "A file changed"}. Follow the agent instructions for this document.`,
      },
    }),
  });
}

async function maybeCreateAutomaticSummaryArtifact(
  claim: ClaimedAgentJob,
  definition: ServerAgentDefinition,
  answer: string,
): Promise<{ id: string; fileName: string; relativePath: string; scopeId: string } | null> {
  const reference = documentReference(claim, definition);
  if (!automaticSummaryAllowed(claim, definition) || !reference) return null;
  return agentsCreateSummaryArtifact({
    agentId: claim.job.agentId,
    jobId: claim.job.id,
    scopeId: reference.scopeId,
    sourceFileName: reference.relativePath,
    content: `# Misty summary\n\n${answer.trim()}\n`,
  });
}

export function automaticSummaryAllowed(claim: ClaimedAgentJob, definition: ServerAgentDefinition): boolean {
  const fileTrigger = claim.job.triggerKind === "file_created" || claim.job.triggerKind === "file_changed";
  const ownerRun = Boolean(definition.ownerUserId && claim.job.requesterUserId === definition.ownerUserId);
  const allowsCreate = definition.trustPolicy?.automaticActions?.includes("create_file") ?? true;
  let workflowAllowsCreate = false;
  try {
    workflowAllowsCreate = planAgentWorkflow(definition.workflow, claim.job.triggerKind).allows("artifact_create", "create_file", "automatic");
  } catch {
    return false;
  }
  return fileTrigger && ownerRun && allowsCreate && workflowAllowsCreate;
}

export async function claimNextJob(
  deviceId: string,
  localDeviceId: string,
): Promise<ClaimedAgentJob | null> {
  return signedAgentDeviceRequest<ClaimedAgentJob>(localDeviceId, `/devices/${encodeURIComponent(deviceId)}/jobs/claim`, { method: "POST" });
}

export function promptForAgentJob(claim: ClaimedAgentJob, definition: ServerAgentDefinition, hasDocument = Boolean(documentReference(claim, definition))): string {
  const payload = recordValue(claim.job.payload);
  const prompt = stringValue(payload.prompt) || stringValue(payload.question) || stringValue(payload.user_message);
  const request = prompt || "Run this agent now and report the useful result.";
  return [
    `You are running the Misty folder agent “${definition.name}”.`,
    `Agent instructions:\n${definition.instructions}`,
    `Job trigger: ${claim.job.triggerKind}.`,
    `Request:\n${request}`,
    hasDocument
      ? "A device-scoped document is available. Call preview_file once before answering and ground every document claim in its returned sections."
      : "No device-scoped document was supplied. Do not invent file contents; explain when a document must be selected in Misty.",
    "This is an unattended run. Device tools remain read-only unless an exact typed workflow action was already approved by the owner; never propose or infer a different mutation.",
  ].join("\n\n");
}

export async function executeManagedMikaJob(
  claim: ClaimedAgentJob,
  definition: ServerAgentDefinition,
  signal: AbortSignal,
): Promise<AgentJobResult> {
  const plan = planAgentWorkflow(definition.workflow, claim.job.triggerKind);
  if (!plan.has("mika_task")) throw new Error("The saved agent workflow has no reachable Mika task step.");
  const resumed = await resumeApprovedMutation(claim, definition, plan);
  if (resumed) return resumed;
  const mayReadDocument = plan.has("document_read") || plan.has("document_ocr");
  const reference = mayReadDocument ? await resolveDocumentReference(claim, definition, plan) : null;
	const initialDocument = reference
		? await agentsPrepareScopedDocument({ scopeId: reference.scopeId, relativePath: reference.relativePath, ocrPageStart: 0, ocrPageLimit: 8 })
    : null;
  const session = await createAgentSession(claim.job.id);
  let sequence = 0;
  let answer = "";
  let citations: AgentCitation[] = [];
  let creditsUsed = 0;
	let documentCursor: number | null = initialDocument ? 0 : null;
	const logicalDocumentId = initialDocument?.documentId ?? null;
  let continuationRequests = 0;
  const startedAt = Date.now();
  const cancel = () => { void cancelAgentSession(session.session_id).catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await sendAgentMessage(session.session_id, {
      mode: "auto",
      user_message: promptForAgentJob(claim, definition, Boolean(reference)),
		capabilities: { tools: initialDocument ? [{ name: "preview_file", risk: "read" }] : [] },
    });
    while (!signal.aborted && Date.now() - startedAt < maxJobRuntimeMs) {
      const response = await fetchAgentEvents(session.session_id, sequence);
		let submittedDocumentTools = false;
      let sawAssistantMessage = false;
      for (const event of response.events) {
        sequence = Math.max(sequence, event.sequence);
        if (event.type === "error") throw new Error(event.message || "Mika could not complete this job.");
        if (event.type === "tool_request") {
			const results: ToolResult[] = await Promise.all((event.tool_requests ?? []).map(async (tool) => {
				if (tool.name === "preview_file" && initialDocument && reference && logicalDocumentId && documentCursor !== null) {
					const cursor = documentCursor;
					const prepared = cursor === 0
						? initialDocument
						: await agentsPrepareScopedDocument({ scopeId: reference.scopeId, relativePath: reference.relativePath, ocrPageStart: cursor, ocrPageLimit: 8 });
					const batch = preparedDocumentBatch({ ...prepared, documentId: logicalDocumentId }, cursor);
					documentCursor = batch.nextCursor;
					const attachment = await uploadPreparedDocumentBatch(claim.job.id, reference.scopeId, reference.relativePath, batch);
					submittedDocumentTools = true;
					return { request_id: tool.id, name: tool.name, ok: true, result: attachment };
				}
				return {
                  request_id: tool.id,
                  name: tool.name,
                  ok: false,
                  error: "This unattended job has no permission for that device tool.",
				};
			}));
			if (results.length) await submitToolResultsWithRetry(session.session_id, results, signal);
        }
        if (event.type === "assistant_message" && event.text?.trim()) {
          sawAssistantMessage = true;
          answer = event.text.trim();
			citations = mergeCitations(citations, event.citations ?? []);
          creditsUsed += event.credits_used ?? 0;
        }
      }
		if (sawAssistantMessage && answer && documentCursor !== null && !submittedDocumentTools) {
			continuationRequests += 1;
			if (continuationRequests > 24) throw new Error("Mika exceeded the document continuation limit.");
			await sendAgentMessage(session.session_id, {
				mode: "auto",
				user_message: `Continue reading the same document. Request preview_file for the next batch beginning at section cursor ${documentCursor}; do not provide the final answer until hasMore is false.`,
				capabilities: { tools: [{ name: "preview_file", risk: "read" }] },
			});
			continue;
		}
		if (sawAssistantMessage && answer && !submittedDocumentTools) {
        const result = { answer, citations, creditsUsed };
        await executeOrRequestPlannedMutation(claim, definition, plan, result);
        return result;
      }
      await waitFor(activePollMs, signal);
    }
    throw new Error(signal.aborted ? "The job was canceled." : "Mika did not finish before the device job timeout.");
  } finally {
    signal.removeEventListener("abort", cancel);
		forgetJobAttachmentEnvelope(claim.job.id);
  }
}

interface ScopedDocumentReference { scopeId: string; relativePath: string; }

async function resolveDocumentReference(
  claim: ClaimedAgentJob,
  definition: ServerAgentDefinition,
  plan: WorkflowPlan,
): Promise<ScopedDocumentReference | null> {
  const explicit = documentReference(claim, definition);
  if (explicit || !definition.cloudDocumentConsent || !mistyDocumentsEnabled() || !definition.scopeId) return explicit;
  const payload = recordValue(claim.job.payload);
  const query = stringValue(payload.prompt) || stringValue(payload.question) || stringValue(payload.user_message);
  if (!plan.has("folder_query")) return null;
  const relativePath = await agentsFindScopeDocument({ scopeId: definition.scopeId, query }).catch(() => null);
  return relativePath ? { scopeId: definition.scopeId, relativePath } : null;
}

async function executeOrRequestPlannedMutation(
  claim: ClaimedAgentJob,
  definition: ServerAgentDefinition,
  plan: WorkflowPlan,
  result: AgentJobResult,
): Promise<void> {
  const configured = plannedMutation(plan, definition.scopeId);
  if (!configured) return;
  if (!definition.ownerUserId || claim.job.requesterUserId !== definition.ownerUserId) {
    throw new Error("Only the agent owner may run a file mutation workflow.");
  }
  const action = await bindMutationContent(configured, result.answer);
  const response = await managedAiRequest<{ approvals: AgentApproval[] }>("/agents/approvals");
  const approval = response.approvals.find((candidate) => candidate.jobId === claim.job.id);
  if (!approval) {
    const created = await managedAiRequest<{ actionDigest: string }>(`/agents/jobs/${encodeURIComponent(claim.job.id)}/approvals`, {
      method: "POST",
      body: JSON.stringify({
        deviceId: claim.job.deviceId,
        leaseToken: claim.leaseToken,
        action: canonicalApprovalAction(action),
      }),
    });
		try {
			await agentsStageApprovedAction({
				agentId: claim.job.agentId,
				jobId: claim.job.id,
				actionDigest: created.actionDigest,
				kind: action.kind,
				summary: action.summary,
				scopeId: action.scopeId,
				relativePaths: action.relativePaths,
				destinationRelativePath: action.destinationRelativePath,
				content: action.kind === "overwrite" ? result.answer : undefined,
				contentSha256: action.contentSha256,
				unixMode: action.unixMode,
				result,
			});
		} catch (error) {
			await managedAiRequest(`/agents/jobs/${encodeURIComponent(claim.job.id)}/cancel`, { method: "POST" }).catch(() => undefined);
			throw error;
		}
    throw new AwaitingApprovalError("This job is waiting for owner approval.");
  }
  if (approval.status === "pending") throw new AwaitingApprovalError("This job is waiting for owner approval.");
  if (approval.status !== "approved" || !sameApprovedAction(approval, action)) {
    throw new Error("The approved action does not match the current saved workflow.");
  }
  await agentsExecuteApprovedAction({
    agentId: claim.job.agentId,
    jobId: claim.job.id,
    actionDigest: approval.action.digest,
    kind: action.kind,
    summary: action.summary,
    scopeId: action.scopeId,
    relativePaths: action.relativePaths,
    destinationRelativePath: action.destinationRelativePath,
    content: action.kind === "overwrite" ? result.answer : undefined,
    contentSha256: action.contentSha256,
    unixMode: action.unixMode,
  });
}

async function resumeApprovedMutation(
  claim: ClaimedAgentJob,
  definition: ServerAgentDefinition,
  plan: WorkflowPlan,
): Promise<AgentJobResult | null> {
  const configured = plannedMutation(plan, definition.scopeId);
  if (!configured) return null;
  const response = await managedAiRequest<{ approvals: AgentApproval[] }>("/agents/approvals");
  const approval = response.approvals.find((candidate) => candidate.jobId === claim.job.id);
  if (!approval) return null;
  if (approval.status === "pending") throw new AwaitingApprovalError("This job is waiting for owner approval.");
  if (approval.status !== "approved" || !sameApprovedActionIdentity(approval, configured)) {
    throw new Error("The approved action does not match the current saved workflow.");
  }
  const completed = await agentsExecuteApprovedAction({
    agentId: claim.job.agentId,
    jobId: claim.job.id,
    actionDigest: approval.action.digest,
    kind: configured.kind,
    summary: configured.summary,
    scopeId: configured.scopeId,
    relativePaths: configured.relativePaths,
    destinationRelativePath: configured.destinationRelativePath,
    contentSha256: approval.action.contentSha256 ?? undefined,
    unixMode: approval.action.unixMode ?? undefined,
  });
  const result = completed.result;
  if (!result?.answer) throw new Error("The staged Mika result is no longer available on this device.");
  return { answer: result.answer, citations: result.citations ?? [], creditsUsed: result.creditsUsed ?? 0 };
}

async function bindMutationContent(action: PlannedMutationAction, answer: string): Promise<PlannedMutationAction> {
  if (action.kind !== "overwrite") return action;
  if (action.contentSource !== "mika_answer") throw new Error("Overwrite approval must bind its exact content to the Mika answer.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(answer));
  return { ...action, contentSha256: [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("") };
}

function canonicalApprovalAction(action: PlannedMutationAction): Record<string, unknown> {
  return {
    kind: action.kind,
    summary: action.summary,
    scopeId: action.scopeId,
    relativePaths: action.relativePaths,
    ...(action.destinationRelativePath ? { destinationRelativePath: action.destinationRelativePath } : {}),
    ...(action.contentSha256 ? { contentSha256: action.contentSha256 } : {}),
    ...(action.unixMode !== undefined ? { unixMode: action.unixMode } : {}),
  };
}

function sameApprovedAction(approval: AgentApproval, action: PlannedMutationAction): boolean {
  return sameApprovedActionIdentity(approval, action)
    && (approval.action.contentSha256 || "") === (action.contentSha256 || "")
    && (approval.action.unixMode ?? null) === (action.unixMode ?? null);
}

function sameApprovedActionIdentity(approval: AgentApproval, action: PlannedMutationAction): boolean {
  return approval.action.kind === action.kind
    && approval.action.summary === action.summary
    && approval.action.scopeId === action.scopeId
    && approval.action.relativePaths.length === action.relativePaths.length
    && approval.action.relativePaths.every((path, index) => path === action.relativePaths[index])
    && (approval.action.destinationRelativePath || "") === (action.destinationRelativePath || "")
    && (approval.action.unixMode ?? null) === (action.unixMode ?? null);
}

export function documentReference(
  claim: ClaimedAgentJob,
  definition: ServerAgentDefinition,
): ScopedDocumentReference | null {
  if (!definition.cloudDocumentConsent || !mistyDocumentsEnabled()) return null;
  const payload = recordValue(claim.job.payload);
  const requestedScopeId = stringValue(payload.scopeId) || stringValue(payload.scope_id);
  const scopeId = stringValue(definition.scopeId);
  const relativePath = stringValue(payload.relativePath)
    || stringValue(payload.relative_path)
    || stringValue(payload.fileName)
    || stringValue(payload.file_name);
  if (!scopeId || (requestedScopeId && requestedScopeId !== scopeId) || !relativePath || relativePath.startsWith("/") || relativePath.includes("..")) return null;
  return { scopeId, relativePath };
}

export function completionPayload(result: AgentJobResult): Record<string, unknown> {
  return {
    answer: result.answer,
    creditsUsed: result.creditsUsed,
    citations: result.citations.map((citation) => ({
      scopeId: citation.scopeId,
      fileName: citation.fileName,
      relativePath: citation.relativePath,
      label: citation.label,
      kind: citation.kind,
      page: citation.page ?? undefined,
      slide: citation.slide ?? undefined,
      sheet: citation.sheet ?? undefined,
      range: citation.range ?? undefined,
      section: citation.section ?? undefined,
      excerpt: citation.excerpt ?? undefined,
    })),
  };
}

function leaseAction(
  serverDeviceId: string,
  path: string,
  leaseToken: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const localDeviceId = localDeviceByServerDevice(serverDeviceId);
  return signedAgentDeviceRequest(localDeviceId, path, { method: "POST", body: JSON.stringify({ leaseToken, ...body }) });
}

function localDeviceByServerDevice(serverDeviceId: string): string {
  // The active local identity is stable and is available from the native
  // snapshot. This function is only reached after a successful registration.
  const snapshotDevice = currentLocalDeviceId;
  if (!snapshotDevice) throw new Error(`No local signer is bound to ${serverDeviceId}.`);
  return snapshotDevice;
}

let currentLocalDeviceId: string | null = null;

async function loadLocalAgentDevice(): Promise<AgentDevice> {
  const snapshot = await agentsSnapshot();
  if (!snapshot.device || snapshot.device.status === "revoked") throw new Error("This Misty device is unavailable.");
  currentLocalDeviceId = snapshot.device.id;
  return snapshot.device;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeErrorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value
    .replace(/[A-Za-z]:[\\/][^\s"']+/g, "[local file]")
    .replace(/(^|[\s("'])\/(?:[^\s"']+)/g, "$1[local file]")
    .slice(0, 1000) || "Device execution failed.";
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
  });
}

async function submitToolResultsWithRetry(sessionId: string, results: ToolResult[], signal: AbortSignal): Promise<void> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			await submitToolResults(sessionId, results);
			return;
		} catch (error) {
			if (!(error instanceof ManagedAiRequestError) || error.code !== "rate_limited" || attempt >= 5 || signal.aborted) throw error;
			const delay = Math.min(60_000, Math.max(1_000, (error.retryAfterSeconds ?? 1) * 1_000));
			await waitFor(delay, signal);
		}
	}
}

function mergeCitations(current: AgentCitation[], incoming: AgentCitation[]): AgentCitation[] {
	const merged = new Map<string, AgentCitation>();
	for (const citation of [...current, ...incoming]) {
		const key = [citation.scopeId, citation.relativePath, citation.kind, citation.page, citation.slide, citation.sheet, citation.range, citation.section].join("|");
		merged.set(key, citation);
	}
	return [...merged.values()].slice(0, 100);
}

export function agentEventsAnswer(events: AgentEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "assistant_message" && event.text?.trim()) return event.text.trim();
  }
  return null;
}
