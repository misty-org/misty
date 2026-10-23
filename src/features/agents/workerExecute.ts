import { devicesNative } from "@/native/devices";
import { executeBrowserJob } from "./browserJobRun";
import { deviceAgentOperations, runDeviceAgentOperation } from "./deviceAgentTools";
import { agentsPrepareScopedDocument } from "./store/useAgentsStore";
import { DeviceOperationNotAttempted, type ClaimedWorkflowNodeJob } from "./workerBrowserJobs";
import { deviceContentReference } from "./workerDeviceJobs";

/** Runs one claimed job on this computer, after checking the grant the asking device signed. */
export async function executeWorkflowNodeOnDevice(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
  lease: () => string | null | undefined,
  deviceId: string,
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
  if (job.operation === "browser.session") {
    // The agent's own browser session on this computer, for a run sent from here.
    return (await import("./hostedSessions")).startHostedSession(job, signal);
  }
  if (job.operation === "browser.spawn_tabs") {
    // Tabs and signed grants for this task's sub-agents.
    return (await import("./spawnChildTabs")).spawnChildTabs(job, signal);
  }
  if (job.operation === "browser.act") {
    // One goal runs as a local loop: Midscene plans, Misty's native input acts.
    return (await import("./screenAct/screenActJob")).runScreenAct(job, signal);
  }
  if (job.operation === "browser.run") {
    // A program the agent wrote, run in a sandbox against its own tabs (programs/runProgram.ts).
    return (await import("./programs/runProgram")).runProgram(job, signal, lease);
  }
  if (job.operation.startsWith("browser.")) return executeBrowserJob(job, signal, lease());
  if (deviceAgentOperations.has(job.operation)) {
    return runDeviceAgentOperation(job, signal);
  }
  if (job.operation === "code.delegate") {
    // Coding through the person's own tool; the run reports on its own.
    return (await import("./coding/codingRun")).startCodingRun(job, deviceId);
  }
  if (job.operation !== "read_content") {
    throw new Error(`unsupported_device_operation:${job.operation}`);
  }
  return readDeviceContent(job, signal);
}

/** Reads one file in a folder the run was granted, as sections the agent can cite. */
async function readDeviceContent(job: ClaimedWorkflowNodeJob["job"], signal: AbortSignal) {
  const ref = deviceContentReference(job.input, job.scopeId);
  const document = await agentsPrepareScopedDocument(
    { scopeId: ref.scopeId, relativePath: ref.relativePath },
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

/** Settles with the operation, or rejects as soon as the signal aborts. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("device_execution_stopped"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
