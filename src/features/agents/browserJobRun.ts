import { invoke } from "@tauri-apps/api/core";
import { pictureAgentTab } from "./agentTabPictures";
import { agentTab, noteAgentTabJob, wakeAgentTab } from "./agentTabs";
import { touchHostedSession } from "./hostedSessionsState";
import { isBrowserSnapshotStale } from "./workerDeviceJobs";
import {
  browserAgentExecutionRequest,
  browserDeviceRequest,
  browserRuntimeIdForScope,
  DeviceOperationNotAttempted,
  registerRunBoundBrowserContext,
  type ClaimedWorkflowNodeJob,
} from "./workerBrowserJobs";

/** The native lease a browser job's execution runs under: its own id, the job's deadline. */
export function browserExecutionControl(
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

const blank = (url: unknown) => typeof url !== "string" || url === "" || url === "about:blank";
const pageUrl = (output: Record<string, unknown>) =>
  (output.page as { url?: unknown } | undefined)?.url ?? output.url;

/**
 * One browser operation in a tab, as a device job runs it: the tab wakes if it sleeps, a
 * run-bound grant names this operation alone, and the native side runs it under the job's
 * lease. A browser_run program's page calls take the same path (programs/runProgram.ts).
 *
 * A look (snapshot, find) at an agent tab that answers about:blank while the tab last showed a
 * real page caught it between documents (a wake, a reload). That says nothing about the page:
 * look once more, then open the address the tab last showed and look again. Without this a run
 * read "about:blank" for twenty turns while its tab showed the site.
 */
export async function executeBrowserJob(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
  leaseExpiresAt: string | null | undefined,
): Promise<Record<string, unknown>> {
  let output = await executeOnce(job, signal, leaseExpiresAt);
  const known = agentTab(job.scopeId)?.url;
  if (!["browser.snapshot", "browser.find"].includes(job.operation) || blank(known)) return output;
  if (!blank(pageUrl(output))) return output;
  await new Promise((done) => setTimeout(done, 1_500));
  output = await executeOnce({ ...job, id: `${job.id}.again` }, signal, leaseExpiresAt);
  if (!blank(pageUrl(output))) return output;
  await executeOnce(
    {
      ...job,
      id: `${job.id}.reopen`,
      operation: "browser.navigate",
      input: { scopeId: job.scopeId, url: known },
    },
    signal,
    leaseExpiresAt,
  );
  return executeOnce({ ...job, id: `${job.id}.reopened` }, signal, leaseExpiresAt);
}

async function executeOnce(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
  leaseExpiresAt: string | null | undefined,
): Promise<Record<string, unknown>> {
  touchHostedSession(job.scopeId, job.runId);
  // An agent's sleeping tab opens its page again first (agentTabs.ts); one whose run's lease
  // ended stays asleep and the job is not attempted.
  if (agentTab(job.scopeId) && !(await wakeAgentTab(job.scopeId)))
    throw new DeviceOperationNotAttempted(new Error("agent_tab_closed"));
  noteAgentTabJob(job.scopeId, job.runId, true);
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
    noteAgentTabJob(job.scopeId, job.runId, false);
    void pictureAgentTab(job.scopeId);
    signal.removeEventListener("abort", cancel);
    const id = await browserRuntimeIdForScope(job.scopeId).catch(() => null);
    if (id)
      await invoke("browser_agent_grant_revoke", {
        request: { id, grantId: `${job.contextId}:${job.id}` },
      }).catch(() => undefined);
  }
}
