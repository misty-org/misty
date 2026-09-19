import { mistyDeviceJobsEnabled } from "./flags";
import { devicesApi } from "@/api/devices/api";
import type { AgentDevice } from "./model/interfaces/types";
import {
  ensureServerAgentDevice,
  heartbeatServerAgentDevice,
  signedAgentDeviceRequest,
} from "./store/useAgentDeviceStore";
import { agentsDeviceSnapshot, agentsPrepareScopedDocument } from "./store/useAgentsStore";
import { invoke } from "@tauri-apps/api/core";
import { browserRuntimeIdForScope } from "@/features/browser/browserRuntime";

const leaseHeartbeatMs = 20_000;
const activePollMs = 750;
const idlePollMs = 4_000;
const hiddenPollMs = 15_000;
const nodeExecutionTimeoutMs = 5 * 60_000;

export class DesktopAgentJobWorker {
  private generation = 0;
  private running = false;
  private active: AbortController | null = null;

  start(): void {
    if (this.running || !mistyDeviceJobsEnabled()) return;
    this.running = true;
    void this.loop(++this.generation);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.active?.abort(new Error("device_execution_stopped"));
  }

  private async loop(generation: number): Promise<void> {
    const current = () => this.running && this.generation === generation;
    while (current()) {
      let waitMs = document.visibilityState === "hidden" ? hiddenPollMs : idlePollMs;
      try {
        const localDevice = await loadLocalAgentDevice();
        if (!current()) return;
        const serverDevice = await ensureServerAgentDevice(localDevice);
        if (!current()) return;
        const claim = await claimNextWorkflowNodeJob(serverDevice.id, localDevice.id);
        if (!current()) return; // An unstarted lease may safely expire.
        if (claim) {
          waitMs = activePollMs;
          await this.runWorkflowNodeClaim(claim, localDevice.id, serverDevice.id);
        }
      } catch {
        waitMs = hiddenPollMs;
      }
      if (current()) await wait(waitMs);
    }
  }

  private async runWorkflowNodeClaim(claim: ClaimedWorkflowNodeJob, localDeviceId: string, deviceId: string): Promise<void> {
    const controller = new AbortController();
    this.active = controller;
    let job = claim.job;
    let leaseExpiresAt = claim.leaseExpiresAt ?? job.leaseExpiresAt;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let renewing = false;
    let began = false;
    let report: () => Promise<unknown>;
    const arm = () => {
      clearTimeout(timer);
      const remaining = deviceExecutionRemaining(job, leaseExpiresAt);
      timer = setTimeout(() => controller.abort(new Error("device_execution_expired")), remaining);
    };
    try {
      arm();
      job = await devicesApi.beginWorkflowJob<ClaimedWorkflowNodeJob["job"]>(signedAgentDeviceRequest, localDeviceId, deviceId, job.id, claim.leaseToken);
      began = true;
      leaseExpiresAt = job.leaseExpiresAt;
      controller.signal.throwIfAborted();
      arm();
      heartbeat = setInterval(() => {
        if (renewing || controller.signal.aborted) return;
        renewing = true;
        void (async () => {
          try {
            const renewed = await devicesApi.renewWorkflowJobLease<ClaimedWorkflowNodeJob["job"]>(signedAgentDeviceRequest, localDeviceId, deviceId, job.id, claim.leaseToken);
            if (controller.signal.aborted) return;
            if (renewed.id !== job.id || renewed.deadlineAt !== job.deadlineAt || renewed.cancelRequestedAt) throw new Error("device_execution_stopped");
            leaseExpiresAt = renewed.leaseExpiresAt;
            arm();
            if (job.operation.startsWith("browser.")) await invoke("browser_agent_execution_renew", { request: browserExecutionControl(job, leaseExpiresAt) });
            await heartbeatServerAgentDevice(deviceId, localDeviceId);
          } catch (error) {
            const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
            if ([401,403,409,410,422].includes(status) || String(error).includes("device_execution")) controller.abort(error);
            // A lost renewal response never extends the last acknowledged lease.
          } finally { renewing = false; }
        })();
      }, leaseHeartbeatMs);
      const output = await abortable(executeWorkflowNodeOnDevice(job, controller.signal, leaseExpiresAt), controller.signal);
      report = () => devicesApi.completeWorkflowJob(signedAgentDeviceRequest, localDeviceId, deviceId, job.id, { leaseToken: claim.leaseToken, output });
    } catch (error) {
      // After begin, a lost native response may conceal an external effect.
      // Keep completion delivery outside this catch: a lost receipt is not failure.
      const uncertain = began && job.operation.startsWith("browser.") && !(error instanceof DeviceOperationNotAttempted);
      report = () => (uncertain ? devicesApi.uncertainWorkflowJob : devicesApi.failWorkflowJob)(signedAgentDeviceRequest, localDeviceId, deviceId, job.id, {
        leaseToken: claim.leaseToken, errorCode: uncertain ? "device_execution_uncertain" : deviceWorkflowErrorCode(error),
      });
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
      if (this.active === controller) this.active = null;
    }
    // Retry only delivery of the exact observed result, never the operation.
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await report(); return; } catch { if (attempt < 2) await wait(500 * (attempt + 1)); }
    }
  }
}

export function deviceExecutionRemaining(job: ClaimedWorkflowNodeJob["job"], leaseExpiresAt: string | null | undefined): number {
  if (job.controlVersion !== 2 || job.cancelRequestedAt) throw new Error("device_execution_stopped");
  const deadline = Date.parse(job.deadlineAt ?? "");
  const lease = Date.parse(leaseExpiresAt ?? "");
  const remaining = Math.min(deadline, lease) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > nodeExecutionTimeoutMs) throw new Error("device_execution_expired");
  return remaining;
}

function browserExecutionControl(job: ClaimedWorkflowNodeJob["job"], leaseExpiresAt: string | null | undefined) {
  return { executionId: job.id, deadlineAt: job.deadlineAt, leaseExpiresAt, scopeId: job.scopeId, grantId: `${job.contextId}:${job.id}` };
}

async function claimNextWorkflowNodeJob(
  deviceId: string,
  localDeviceId: string,
): Promise<ClaimedWorkflowNodeJob | null> {
  const claim = await devicesApi.claimWorkflowJob<ClaimedWorkflowNodeJob | undefined>(
    signedAgentDeviceRequest,
    localDeviceId,
    deviceId,
  );
  return claim ?? null;
}

async function executeWorkflowNodeOnDevice(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
  leaseExpiresAt: string | null | undefined,
): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  if (job.operation.startsWith("browser.")) {
    const cancel = () => { void invoke("browser_agent_execution_cancel", { request: browserExecutionControl(job, leaseExpiresAt) }).catch(() => undefined); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      try {
        await registerRunBoundBrowserContext(job);
        signal.throwIfAborted();
      } catch (error) { throw new DeviceOperationNotAttempted(error); }
      return await invoke<Record<string, unknown>>("browser_agent_execute_bounded", {
        request: { control: browserExecutionControl(job, leaseExpiresAt), operation: browserAgentExecutionRequest(job) },
      });
    } catch (error) {
      if (String(error).startsWith("browser_snapshot_stale:")) throw new DeviceOperationNotAttempted(error);
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
      const id = browserRuntimeIdForScope(job.scopeId);
      if (id) await invoke("browser_agent_grant_revoke", { request: { id, grantId: `${job.contextId}:${job.id}` } }).catch(() => undefined);
    }
  }
  if (job.operation !== "read_content") {
    throw new Error(`unsupported_device_operation:${job.operation}`);
  }
  const ref = deviceContentReference(job.input, job.scopeId);
  const document = await agentsPrepareScopedDocument({
    scopeId: ref.scopeId,
    relativePath: ref.relativePath,
    spaceId: job.spaceId ?? "",
  }, signal);
  const content = {
    sourceKind: ref.sourceKind || "local_file",
    providerId: ref.providerId || "device",
    resourceId: ref.resourceId || `${ref.scopeId}:${ref.relativePath}`,
    version: ref.version || "",
    fingerprint: ref.fingerprint || "",
    mimeType: document.mimeType,
    displayName: document.displayName,
    locator: ref.relativePath,
    permissionScope: ref.scopeId,
  };
  return {
    content,
    sections: document.sections.map((section) => ({
      kind: section.kind,
      locator: section.locator,
      text: section.text,
    })),
    citations: document.sections.map((section) => ({
      content,
      kind: section.kind,
      locator: section.locator,
      excerpt: section.text.slice(0, 240),
    })),
    truncated: document.truncated,
    sourceChanged: false,
  };
}

export function browserAgentExecutionRequest(job: ClaimedWorkflowNodeJob["job"]) {
  const contextId = job.contextId;
  if (!job.operation.startsWith("browser.") || !contextId || !job.scopeId) {
    throw new Error("invalid_browser_grant");
  }
  const agentId =
    job.config && typeof job.config === "object" && "agentId" in job.config
      ? String(job.config.agentId)
      : "";
  if (!agentId) throw new Error("invalid_browser_grant");
  return {
    scopeId: job.scopeId,
    grantId: `${contextId}:${job.id}`,
    agentId,
    operation: job.operation,
    input: job.input && typeof job.input === "object" ? job.input : {},
  };
}

async function registerRunBoundBrowserContext(job: ClaimedWorkflowNodeJob["job"]): Promise<void> {
  const contextId = job.contextId;
  const config =
    job.config && typeof job.config === "object" ? (job.config as Record<string, unknown>) : {};
  const agentId = String(config.agentId || "");
  const capabilities = Array.isArray(config.contextCapabilities)
    ? config.contextCapabilities.map(String)
    : [];
  const expiresAt = String(config.contextExpiresAt || "");
  if (!contextId || !agentId || !expiresAt || !capabilities.includes(job.operation)) {
    throw new Error("invalid_browser_grant");
  }
  const runtimeId = browserRuntimeIdForScope(job.scopeId);
  if (!runtimeId) throw new Error("browser_context_closed");
  await invoke("browser_agent_grant_register", {
    request: {
      id: runtimeId,
      scopeId: job.scopeId,
      grantId: `${contextId}:${job.id}`,
      agentId,
      capabilities: [job.operation],
      expiresAt: new Date(Math.min(Date.parse(expiresAt), Date.parse(job.deadlineAt ?? ""))).toISOString(),
    },
  });
}

export function deviceContentReference(
  input: unknown,
  expectedScopeId: string,
): Record<string, string> {
  const ref = findDeviceContentReference(input);
  if (
    !ref ||
    ref.scopeId !== expectedScopeId ||
    !ref.relativePath ||
    ref.relativePath.startsWith("/") ||
    ref.relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new Error("invalid_device_scope");
  }
  return { ...ref, scopeId: expectedScopeId, relativePath: ref.relativePath };
}

function findDeviceContentReference(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidate = (record.contentRef ?? record.content) as Record<string, unknown> | undefined;
  const source = candidate && typeof candidate === "object" ? candidate : record;
  const scopeId = stringValue(source.scopeId) || stringValue(source.permissionScope);
  const relativePath = stringValue(source.relativePath) || stringValue(source.locator);
  if (scopeId && relativePath) {
    return {
      ...Object.fromEntries(
        Object.entries(source).map(([key, entry]) => [key, stringValue(entry)]),
      ),
      scopeId,
      relativePath,
    };
  }
  for (const child of Object.values(record)) {
    const found = findDeviceContentReference(child);
    if (found) return found;
  }
  return null;
}

class DeviceOperationNotAttempted extends Error {
  constructor(error: unknown) { super(error instanceof Error ? error.message : String(error)); }
}

export function deviceWorkflowErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Add Files")) return "files_app_required";
  if (message.includes("document service") || message.includes("processor")) return "document_service_unavailable";
  if (message.startsWith("browser_snapshot_stale:")) return "browser_snapshot_stale";
  if (message.includes("unsupported_content")) return "unsupported_content";
  if (message.includes("invalid_device_scope")) return "invalid_scope";
  if (message.includes("unsupported_device_operation")) return "unsupported_operation";
  if (message.includes("invalid_browser_grant") || message.includes("not active"))
    return "browser_grant_invalid";
  if (message.includes("browser_context_closed") || message.includes("not open") || message.includes("not running")) return "browser_tab_closed";
  if (message.includes("timed out")) return "browser_timeout";
  if (message.includes("inspect it again") || message.includes("page changed"))
    return "browser_snapshot_stale";
  if (message.includes("device_node_timeout")) return "device_timeout";
  return "device_execution_failed";
}

async function loadLocalAgentDevice(): Promise<AgentDevice> {
  const snapshot = await agentsDeviceSnapshot();
  if (!snapshot.device || snapshot.device.status === "revoked") {
    throw new Error("This Misty device is unavailable.");
  }
  return snapshot.device;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("device_execution_stopped"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export interface ClaimedWorkflowNodeJob {
  job: {
    spaceId?: string;
    id: string;
    runId: string;
    nodeId: string;
    scopeId: string;
    operation: string;
    contextId?: string;
    attempt: number;
    controlVersion?: number;
    deadlineAt?: string;
    leaseExpiresAt?: string | null;
    cancelRequestedAt?: string | null;
    input: unknown;
    config: unknown;
  };
  leaseToken: string;
  leaseExpiresAt?: string | null;
}
