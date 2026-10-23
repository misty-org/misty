import { invoke } from "@tauri-apps/api/core";
import { devicesApi } from "@/api/devices/api";
import { browserExecutionControl } from "./browserJobRun";
import { heartbeatServerAgentDevice, signedAgentDeviceRequest } from "./store/useAgentDeviceStore";
import type { ClaimedWorkflowNodeJob } from "./workerBrowserJobs";
import type { HeldClaims } from "./workerHeldClaim";

const nodeExecutionTimeoutMs = 5 * 60_000;

/** How long a claimed job may still run: until its deadline or its lease, whichever is first. */
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

/**
 * Renews a running job's lease once; `renewed` takes the new expiry. A job the server stopped
 * or no longer recognizes is aborted.
 */
export async function renewJobLease(
  job: ClaimedWorkflowNodeJob["job"],
  leaseToken: string,
  localDeviceId: string,
  deviceId: string,
  controller: AbortController,
  renewed: (leaseExpiresAt: string | null | undefined) => void,
): Promise<void> {
  try {
    const next = await devicesApi.renewWorkflowJobLease<ClaimedWorkflowNodeJob["job"]>(
      signedAgentDeviceRequest,
      localDeviceId,
      deviceId,
      job.id,
      leaseToken,
    );
    if (controller.signal.aborted) return;
    if (next.id !== job.id || next.deadlineAt !== job.deadlineAt || next.cancelRequestedAt)
      throw new Error("device_execution_stopped");
    renewed(next.leaseExpiresAt);
    // A program has no native execution of its own: each page call registers one under
    // its own id and reads the current lease when it starts (programs/pageHost.ts).
    if (job.operation.startsWith("browser.") && job.operation !== "browser.run")
      await invoke("browser_agent_execution_renew", {
        request: browserExecutionControl(job, next.leaseExpiresAt),
      });
    await heartbeatServerAgentDevice(deviceId, localDeviceId);
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    if ([401, 403, 409, 410, 422].includes(status) || String(error).includes("device_execution"))
      controller.abort(error);
    // A lost renewal response never extends the last acknowledged lease.
  }
}

export async function claimNextWorkflowNodeJob(
  deviceId: string,
  localDeviceId: string,
  held: HeldClaims,
): Promise<ClaimedWorkflowNodeJob | null> {
  const hold = held.next();
  try {
    const claim = await devicesApi.claimWorkflowJob<ClaimedWorkflowNodeJob | undefined>(
      signedAgentDeviceRequest,
      localDeviceId,
      deviceId,
      hold,
    );
    return claim ?? null;
  } catch (error) {
    if (hold && held.refused(error)) return claimNextWorkflowNodeJob(deviceId, localDeviceId, held);
    throw error;
  }
}
