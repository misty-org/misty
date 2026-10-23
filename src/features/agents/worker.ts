import { diag } from "./diagnostics";
import { subscribeAccountEvents } from "@/api/account-events";
import { devicesApi } from "@/api/devices/api";
import type { AgentDevice } from "./model/types";
import {
  ensureServerAgentDevice,
  heartbeatServerAgentDevice,
  serverAgentDeviceSeenWithin,
  signedAgentDeviceRequest,
} from "./store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import {
  browserFailureIsCertain,
  browserUncertainErrorCode,
  deviceWorkflowErrorCode,
} from "./workerDeviceJobs";

import { DeviceOperationNotAttempted, type ClaimedWorkflowNodeJob } from "./workerBrowserJobs";
import { HeldClaims } from "./workerHeldClaim";
import { claimNextWorkflowNodeJob, deviceExecutionRemaining, renewJobLease } from "./workerClaims";
import { abortable, executeWorkflowNodeOnDevice } from "./workerExecute";

const leaseHeartbeatMs = 20_000;
// Realtime notifications drop while the socket reconnects (every 15 to 60 s on the dev stack), and
// a run's first page then waited up to 90 s: reconcile on every presence tick instead.
const jobReconciliationMs = 25_000;

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
  private held = new HeldClaims();

  start(accountId: string): void {
    if (this.running) return;
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
    this.held.cancel();
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
        const asked = Date.now();
        diag("worker", `claim active=${this.active.size} holding=${this.held.holding()}`);
        const claim = await claimNextWorkflowNodeJob(serverDevice.id, localDevice.id, this.held);
        diag(
          "worker",
          `claimed ${claim ? claim.job.operation : "none"} after=${Date.now() - asked}ms`,
        );
        if (!current()) {
          // A claim answered after this worker stopped was dropped and stayed leased until its
          // run gave up 30 s later (a run's first page never opened). Put it back instead.
          if (claim)
            void devicesApi
              .releaseWorkflowJob(
                signedAgentDeviceRequest,
                localDevice.id,
                serverDevice.id,
                claim.job.id,
                claim.leaseToken,
              )
              .catch(() => undefined);
          return;
        }
        this.failures = 0;
        // While a run's browser steps are coming, a held claim that came back empty is held
        // again, so the next step is handed over the moment it is queued. One that came back at
        // once was not held (the server keeps one per device): notifications wake the worker.
        if (!claim && this.held.holding() && Date.now() - asked > 2_000) continue;
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
    const startedAt = Date.now();
    controller.signal.addEventListener("abort", () =>
      diag("worker", `aborted ${job.operation} after=${Date.now() - startedAt}ms`),
    );
    this.held.noteJob();
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
      diag(
        "worker",
        `began ${job.operation} after=${Date.now() - startedAt}ms active=${this.active.size}`,
      );
      leaseExpiresAt = job.leaseExpiresAt;
      controller.signal.throwIfAborted();
      arm();
      heartbeat = setInterval(() => {
        if (renewing || controller.signal.aborted) return;
        renewing = true;
        void renewJobLease(job, claim.leaseToken, localDeviceId, deviceId, controller, (next) => {
          leaseExpiresAt = next;
          arm();
        }).finally(() => (renewing = false));
      }, leaseHeartbeatMs);
      const output = await abortable(
        executeWorkflowNodeOnDevice(job, controller.signal, () => leaseExpiresAt, deviceId),
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
        !(error instanceof DeviceOperationNotAttempted) &&
        !browserFailureIsCertain(job.operation, error);
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
      this.held.noteJob();
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
