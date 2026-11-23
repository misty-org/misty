import { devicesNative } from "@/features/devices";
import { recordBrowserLog } from "../../browser-log/record_browser_log";
import { executeBrowserJob } from "./browser_job_run";
import { deviceAgentOperations, runDeviceAgentOperation } from "../../personal/device_agent_tools";
import { DeviceOperationNotAttempted, type ClaimedWorkflowNodeJob } from "./worker_browser_jobs";

export async function executeWorkflowNodeOnDevice(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
  lease: () => string | null | undefined,
): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  try {
    await devicesNative.verifyJob(job.operation, job.scopeId, job.config);
  } catch {
    throw new DeviceOperationNotAttempted(new Error("device_grant_invalid"));
  }
  signal.throwIfAborted();
  if (job.operation === "browser.session") {
    return (await import("../hosted-sessions/hosted_sessions")).startHostedSession(job, signal);
  }
  if (job.operation === "browser.spawn_tabs") {
    return (await import("./spawn_child_tabs")).spawnChildTabs(job, signal);
  }
  if (job.operation === "browser.act") {
    const started = Date.now();
    try {
      const output = await (
        await import("../../desktop-control/screen_act_job")
      ).runScreenAct(job, signal);
      recordBrowserLog(job, { output }, Date.now() - started);
      return output;
    } catch (error) {
      recordBrowserLog(job, { error }, Date.now() - started);
      throw error;
    }
  }
  if (job.operation === "browser.run") {
    return (await import("../../programs/run_program")).runProgram(job, signal, lease);
  }
  if (job.operation.startsWith("browser.")) return executeBrowserJob(job, signal, lease());
  if (deviceAgentOperations.has(job.operation)) {
    return runDeviceAgentOperation(job, signal);
  }
  throw new Error(`unsupported_device_operation:${job.operation}`);
}

export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("device_execution_stopped"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
