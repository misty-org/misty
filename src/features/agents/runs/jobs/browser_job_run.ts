import { invoke } from "@tauri-apps/api/core";
import { recordBrowserLog } from "../../browser-log/record_browser_log";
import { extractOnEngine } from "../../engines/misty_calls";
import { pictureAgentTab } from "../../tabs/agent_tab_pictures";
import { agentTab, noteAgentTabJob, wakeAgentTab } from "../../tabs/agent_tabs";
import { touchHostedSession } from "../hosted-sessions/hosted_sessions_state";
import { isBrowserSnapshotStale } from "./worker_device_jobs";
import {
  browserAgentExecutionRequest,
  browserDeviceRequest,
  browserRuntimeIdForScope,
  DeviceOperationNotAttempted,
  registerRunBoundBrowserContext,
  type ClaimedWorkflowNodeJob,
} from "./worker_browser_jobs";

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

const blank = (url: unknown) => typeof url !== "string" || url === "" || url === "about:blank";
const pageUrl = (output: Record<string, unknown>) =>
  (output.page as { url?: unknown } | undefined)?.url ?? output.url;

export async function executeBrowserJob(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
  leaseExpiresAt: string | null | undefined,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  try {
    const output = await executeLooking(job, signal, leaseExpiresAt);
    recordBrowserLog(job, { output }, Date.now() - started);
    return output;
  } catch (error) {
    recordBrowserLog(job, { error }, Date.now() - started);
    throw error;
  }
}

async function executeLooking(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
  leaseExpiresAt: string | null | undefined,
): Promise<Record<string, unknown>> {
  let output = await executeOnce(job, signal, leaseExpiresAt);
  if (job.operation === "browser.extract") return withExtraction(job, output, signal);
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

async function withExtraction(
  job: ClaimedWorkflowNodeJob["job"],
  page: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const input = (job.input ?? {}) as { instruction?: unknown; schema?: unknown };
  if (typeof input.instruction !== "string" || !input.schema) return page;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const { data } = await extractOnEngine(
    {
      instruction: input.instruction,
      schema: input.schema,
      url: text(page.url),
      title: text(page.title),
      markdown: text(page.markdown).slice(0, 120_000),
    },
    signal,
  );
  return { ...page, data };
}

async function executeOnce(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
  leaseExpiresAt: string | null | undefined,
): Promise<Record<string, unknown>> {
  touchHostedSession(job.scopeId, job.runId);
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
    touchHostedSession(job.scopeId, job.runId);
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
