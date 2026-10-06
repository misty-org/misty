import { subscribeAccountEvents } from "@/api/accountEvents";
import { devicesNative } from "@/native/devices";
import { mistyDeviceJobsEnabled } from "./flags";
import { devicesApi } from "@/api/devices/api";
import type { AgentDevice } from "./model/interfaces/types";
import {
  ensureServerAgentDevice,
  heartbeatServerAgentDevice,
  serverAgentDeviceSeenWithin,
  signedAgentDeviceRequest,
} from "./store/useAgentDeviceStore";
import { agentsDeviceSnapshot, agentsPrepareScopedDocument } from "./store/useAgentsStore";
import { deviceAgentOperations, runDeviceAgentOperation } from "./deviceAgentTools";
import { invoke } from "@tauri-apps/api/core";
import {
  browserUncertainErrorCode,
  isBrowserSnapshotStale,
  deviceContentReference,
  deviceWorkflowErrorCode,
} from "./workerDeviceJobs";

import {
  browserAgentExecutionRequest,
  browserDeviceRequest,
  browserRuntimeIdForScope,
  DeviceOperationNotAttempted,
  registerRunBoundBrowserContext,
  type ClaimedWorkflowNodeJob,
} from "./workerBrowserJobs";

export { deviceContentReference, deviceWorkflowErrorCode } from "./workerDeviceJobs";
export { browserAgentExecutionRequest, browserDeviceRequest } from "./workerBrowserJobs";
export type { ClaimedWorkflowNodeJob } from "./workerBrowserJobs";

const leaseHeartbeatMs = 20_000;
const nodeExecutionTimeoutMs = 5 * 60_000;
const jobReconciliationMs = 60_000;

export class DesktopAgentJobWorker {
  private generation = 0;
  private running = false;
  private active = new Set<AbortController>();

  private unsubscribe?: () => void;
  private retry?: ReturnType<typeof setTimeout>;
  private busy = false;
  private dirty = false;
  private failures = 0;
  private presence?: ReturnType<typeof setInterval>;
  private refreshPresence?: () => Promise<unknown>;
  private presenceBusy = false;
  private lastDiscoveryAt = 0;

  start(accountId: string): void {
    if (this.running || !mistyDeviceJobsEnabled()) return;
    this.running = true;
    this.generation++;
    this.unsubscribe = subscribeAccountEvents(accountId, (event) => {
      if (event.topic === "reset" || event.topic === "jobs") this.wake();
    });
    this.wake();
    // Notifications provide immediate delivery. A bounded claim reconciliation
    // also recovers queued work if a feed handover or reconnect loses its wake.
    // The server's existing claim lease remains the only execution authority.
    this.presence = setInterval(() => {
      if (this.presenceBusy || !this.refreshPresence) return;
      this.presenceBusy = true;
      void this.refreshPresence()
        .catch(() => {})
        .finally(() => {
          this.presenceBusy = false;
          if (Date.now() - this.lastDiscoveryAt >= jobReconciliationMs) this.wake();
        });
    }, 30_000);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.unsubscribe?.();
    clearTimeout(this.retry);
    this.retry = undefined;
    clearInterval(this.presence);
    this.refreshPresence = undefined;
    for (const controller of this.active) controller.abort(new Error("device_execution_stopped"));
  }

  private wake(): void {
    if (!this.running) return;
    this.dirty = true;
    if (!this.busy && !this.retry) void this.drain(this.generation);
  }

  private async drain(generation: number): Promise<void> {
    const current = () => this.running && this.generation === generation;
    this.busy = true;
    this.dirty = false;
    try {
      const localDevice = await loadLocalAgentDevice();
      if (!current()) return;
      const serverDevice = await ensureServerAgentDevice(localDevice);
      if (!current()) return;
      // Connected Devices presence also refreshes this device's liveness on
      // servers that report it; skip the heartbeat while that is recent.
      this.refreshPresence = () =>
        serverAgentDeviceSeenWithin(serverDevice.id, 25_000)
          ? Promise.resolve()
          : heartbeatServerAgentDevice(serverDevice.id, localDevice.id);
      while (current() && this.active.size < 8) {
        this.lastDiscoveryAt = Date.now();
        const claim = await claimNextWorkflowNodeJob(serverDevice.id, localDevice.id);
        if (!current()) return;
        this.failures = 0;
        if (!claim) break;
        void this.runWorkflowNodeClaim(claim, localDevice.id, serverDevice.id).finally(() =>
          this.wake(),
        );
      }
    } catch (error) {
      if (current()) {
        const retryAfter =
          error && typeof error === "object" && "retryAfterSeconds" in error
            ? Number(error.retryAfterSeconds) * 1000
            : 0;
        const delay =
          Math.max(retryAfter || 0, Math.min(60_000, 5_000 * 2 ** Math.min(this.failures++, 4))) +
          Math.random() * 1000;
        this.retry = setTimeout(() => {
          this.retry = undefined;
          this.wake();
        }, delay);
      }
    } finally {
      this.busy = false;
      if (current() && this.dirty && this.active.size < 8 && !this.retry) this.wake();
    }
  }

  private async runWorkflowNodeClaim(
    claim: ClaimedWorkflowNodeJob,
    localDeviceId: string,
    deviceId: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.active.add(controller);
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
      job = await devicesApi.beginWorkflowJob<ClaimedWorkflowNodeJob["job"]>(
        signedAgentDeviceRequest,
        localDeviceId,
        deviceId,
        job.id,
        claim.leaseToken,
      );
      began = true;
      leaseExpiresAt = job.leaseExpiresAt;
      controller.signal.throwIfAborted();
      arm();
      heartbeat = setInterval(() => {
        if (renewing || controller.signal.aborted) return;
        renewing = true;
        void (async () => {
          try {
            const renewed = await devicesApi.renewWorkflowJobLease<ClaimedWorkflowNodeJob["job"]>(
              signedAgentDeviceRequest,
              localDeviceId,
              deviceId,
              job.id,
              claim.leaseToken,
            );
            if (controller.signal.aborted) return;
            if (
              renewed.id !== job.id ||
              renewed.deadlineAt !== job.deadlineAt ||
              renewed.cancelRequestedAt
            )
              throw new Error("device_execution_stopped");
            leaseExpiresAt = renewed.leaseExpiresAt;
            arm();
            if (job.operation.startsWith("browser."))
              await invoke("browser_agent_execution_renew", {
                request: browserExecutionControl(job, leaseExpiresAt),
              });
            await heartbeatServerAgentDevice(deviceId, localDeviceId);
          } catch (error) {
            const status =
              error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
            if (
              [401, 403, 409, 410, 422].includes(status) ||
              String(error).includes("device_execution")
            )
              controller.abort(error);
            // A lost renewal response never extends the last acknowledged lease.
          } finally {
            renewing = false;
          }
        })();
      }, leaseHeartbeatMs);
      const output = await abortable(
        executeWorkflowNodeOnDevice(job, controller.signal, leaseExpiresAt),
        controller.signal,
      );
      report = () =>
        devicesApi.completeWorkflowJob(signedAgentDeviceRequest, localDeviceId, deviceId, job.id, {
          leaseToken: claim.leaseToken,
          output,
        });
    } catch (error) {
      // After begin, a lost native response may conceal an external effect.
      // Keep completion delivery outside this catch: a lost receipt is not failure.
      const uncertain =
        began &&
        job.operation.startsWith("browser.") &&
        !(error instanceof DeviceOperationNotAttempted);
      report = () =>
        (uncertain ? devicesApi.uncertainWorkflowJob : devicesApi.failWorkflowJob)(
          signedAgentDeviceRequest,
          localDeviceId,
          deviceId,
          job.id,
          {
            leaseToken: claim.leaseToken,
            errorCode: uncertain
              ? browserUncertainErrorCode(error)
              : deviceWorkflowErrorCode(error),
          },
        );
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
      this.active.delete(controller);
    }
    // Retry only delivery of the exact observed result, never the operation.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await report();
        return;
      } catch (error) {
        const retryAfter =
          error && typeof error === "object" && "retryAfterSeconds" in error
            ? Number(error.retryAfterSeconds) * 1000
            : 0;
        if (attempt < 2) await wait(Math.max(retryAfter || 0, 500 * (attempt + 1)));
      }
    }
  }
}

export function deviceExecutionRemaining(
  job: ClaimedWorkflowNodeJob["job"],
  leaseExpiresAt: string | null | undefined,
): number {
  if (job.controlVersion !== 2 || job.cancelRequestedAt)
    throw new Error("device_execution_stopped");
  const deadline = Date.parse(job.deadlineAt ?? "");
  const lease = Date.parse(leaseExpiresAt ?? "");
  const remaining = Math.min(deadline, lease) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > nodeExecutionTimeoutMs)
    throw new Error("device_execution_expired");
  return remaining;
}

function browserExecutionControl(
  job: ClaimedWorkflowNodeJob["job"],
  leaseExpiresAt: string | null | undefined,
) {
  return {
    executionId: job.id,
    deadlineAt: job.deadlineAt,
    leaseExpiresAt,
    scopeId: job.scopeId,
    grantId: `${job.contextId}:${job.id}`,
  };
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
  // Every job carries the run grant the asking device signed. This device
  // checks it natively before acting; the server only carried it, and cannot
  // widen it (docs/design/devices/BRIEF.md).
  try {
    await devicesNative.verifyJob(job.operation, job.scopeId, job.config);
  } catch {
    throw new DeviceOperationNotAttempted(new Error("device_grant_invalid"));
  }
  signal.throwIfAborted();
  if (job.operation === "browser.act") {
    // One goal runs as a local loop: Midscene plans, Misty's native input acts.
    return (await import("./screenAct/screenActJob")).runScreenAct(job, signal);
  }
  if (job.operation.startsWith("browser.")) {
    const cancel = () => {
      void invoke("browser_agent_execution_cancel", {
        request: browserExecutionControl(job, leaseExpiresAt),
      }).catch(() => undefined);
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      try {
        await registerRunBoundBrowserContext(job);
        signal.throwIfAborted();
      } catch (error) {
        throw new DeviceOperationNotAttempted(error);
      }
      return await invoke<Record<string, unknown>>("browser_agent_execute_bounded", {
        request: {
          control: browserExecutionControl(job, leaseExpiresAt),
          operation: await browserDeviceRequest(job),
        },
      });
    } catch (error) {
      // Let the coordinator request a new frame; no input was attempted and
      // this is not a terminal desktop-control error for the user.
      if (isBrowserSnapshotStale(error)) throw new DeviceOperationNotAttempted(error);
      if (job.operation.startsWith("browser.workspace.")) {
        window.dispatchEvent(
          new CustomEvent("misty:autopilot-error", {
            detail: {
              taskId: browserAgentExecutionRequest(job).input.__mistyTaskId,
              message: String(error),
            },
          }),
        );
        if (job.operation === "browser.workspace.visual")
          throw new DeviceOperationNotAttempted(error);
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
      const id = await browserRuntimeIdForScope(job.scopeId).catch(() => null);
      if (id)
        await invoke("browser_agent_grant_revoke", {
          request: { id, grantId: `${job.contextId}:${job.id}` },
        }).catch(() => undefined);
    }
  }
  if (deviceAgentOperations.has(job.operation)) {
    return runDeviceAgentOperation(job, signal);
  }
  if (job.operation !== "read_content") {
    throw new Error(`unsupported_device_operation:${job.operation}`);
  }
  const ref = deviceContentReference(job.input, job.scopeId);
  const document = await agentsPrepareScopedDocument(
    {
      scopeId: ref.scopeId,
      relativePath: ref.relativePath,
      spaceId: job.spaceId ?? "",
    },
    signal,
  );
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

async function loadLocalAgentDevice(): Promise<AgentDevice> {
  const snapshot = await agentsDeviceSnapshot();
  if (!snapshot.device || snapshot.device.status === "revoked") {
    throw new Error("This Misty device is unavailable.");
  }
  return snapshot.device;
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
