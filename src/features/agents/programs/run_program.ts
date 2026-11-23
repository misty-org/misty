import { invoke } from "@/native/invoke";
import { startHostedSession } from "../runs/hosted-sessions/hosted_sessions";
import { sessions } from "../runs/hosted-sessions/hosted_sessions_state";
import { agentTabsForTask } from "../tabs/agent_tabs";
import {
  DeviceOperationNotAttempted,
  jobPolicyCall,
  type ClaimedWorkflowNodeJob,
} from "../runs/jobs/worker_browser_jobs";
import { pageHost, type ProgramState } from "./page_host";
import { programPrelude } from "./prelude";
import { runInSandbox } from "./sandbox";

const PROGRAM_MS = 120_000;
const MAX_CODE = 20_000;
const MAX_VALUE = 20_000;
const MAX_SAVED_VALUE = 8_000_000;

export async function runProgram(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
  lease: () => string | null | undefined,
): Promise<Record<string, unknown>> {
  const input = (job.input ?? {}) as {
    code?: unknown;
    conversationId?: unknown;
    scopeId?: unknown;
    saveAs?: unknown;
  };
  const code = typeof input.code === "string" ? input.code : "";
  if (!code.trim() || code.length > MAX_CODE)
    throw new DeviceOperationNotAttempted(
      new Error(`invalid_program: send 1–${MAX_CODE} characters of code`),
    );
  const conversationId = typeof input.conversationId === "string" ? input.conversationId : "";
  const agentId = String((job.config as { agentId?: unknown } | undefined)?.agentId ?? "");
  const session = () =>
    sessions().find(
      (item) =>
        item.conversationId === conversationId && conversationId && item.agentId === agentId,
    );
  const opened: unknown[] = [];
  const state: ProgramState = {
    job,
    signal,
    lease,
    taskId: () => session()?.taskId ?? "",
    calls: 0,
    notes: [],
    kept: new Set(),
    documents: new Map(),
    openTab: async (url) => {
      const policyCall = jobPolicyCall(job.config);
      if (policyCall) await invoke("agent_program_opens", { policyCall, url });
      const result = await startHostedSession(
        {
          ...job,
          id: `${job.id}.open.${opened.length + 1}`,
          operation: "browser.session",
          input: { scopeId: job.scopeId, url, newTab: true, conversationId, reason: "browser_run" },
        },
        signal,
      );
      const tab = (result.tabs as Array<{ opaque_ref?: string }> | undefined)?.[0];
      if (!tab?.opaque_ref) throw new Error("The browser did not open a tab.");
      if (!opened.some((item) => (item as { opaque_ref?: string }).opaque_ref === tab.opaque_ref))
        opened.push(tab);
      return tab.opaque_ref;
    },
  };
  const deadline = Math.min(Date.now() + PROGRAM_MS, Date.parse(job.deadlineAt ?? "") - 15_000);
  if (!Number.isFinite(deadline) || deadline <= Date.now())
    throw new DeviceOperationNotAttempted(new Error("device_execution_expired"));
  const started = Date.now();
  const result = await runInSandbox(programPrelude, code, pageHost(state), { deadline });
  const value = JSON.stringify(result.value ?? null);
  const limit = typeof input.saveAs === "string" ? MAX_SAVED_VALUE : MAX_VALUE;
  return {
    ok: result.ok,
    ...(result.ok
      ? {
          value:
            value.length > limit
              ? `${value.slice(0, limit)}… (cut: return less, or note() rows)`
              : (result.value ?? null),
        }
      : { error: result.error }),
    logs: result.logs,
    notes: state.notes,
    kept: [...state.kept],
    tabs: agentTabsForTask(state.taskId()).map((tab) => ({
      id: tab.scopeId,
      url: tab.url,
      title: tab.title,
    })),
    pageCalls: state.calls,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    opened,
  };
}
