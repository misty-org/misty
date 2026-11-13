import { devicesNative } from "@/features/devices";
import { executeBrowserJob } from "./browserJobRun";
import { deviceAgentOperations, runDeviceAgentOperation } from "../../personal/deviceAgentTools";
import { DeviceOperationNotAttempted, type ClaimedWorkflowNodeJob } from "./workerBrowserJobs";

/** Runs one claimed job on this computer, after checking the grant the asking device signed. */
export async function executeWorkflowNodeOnDevice(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
  lease: () => string | null | undefined,
): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  // Every job carries the run grant the asking device signed. This device
  // checks it natively before acting; the server only carried it, and cannot
  // widen it.
  try {
    await devicesNative.verifyJob(job.operation, job.scopeId, job.config);
  } catch {
    throw new DeviceOperationNotAttempted(new Error("device_grant_invalid"));
  }
  signal.throwIfAborted();
  if (job.operation === "browser.session") {
    // The agent's own browser session on this computer, for a run sent from here.
    return (await import("../hosted-sessions/hostedSessions")).startHostedSession(job, signal);
  }
  if (job.operation === "browser.spawn_tabs") {
    // Tabs and signed grants for this task's sub-agents.
    return (await import("./spawnChildTabs")).spawnChildTabs(job, signal);
  }
  if (job.operation === "browser.act") {
    // One goal runs as a local loop: Midscene plans, Misty's native input acts.
    return (await import("../../desktop-control/screenActJob")).runScreenAct(job, signal);
  }
  if (job.operation === "browser.run") {
    // A program the agent wrote, run in a sandbox against its own tabs (programs/runProgram.ts).
    return (await import("../../programs/runProgram")).runProgram(job, signal, lease);
  }
  if (job.operation.startsWith("browser.")) return executeBrowserJob(job, signal, lease());
  if (deviceAgentOperations.has(job.operation)) {
    return runDeviceAgentOperation(job, signal);
  }
  throw new Error(`unsupported_device_operation:${job.operation}`);
}

/** Settles with the operation, or rejects as soon as the signal aborts. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("device_execution_stopped"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
