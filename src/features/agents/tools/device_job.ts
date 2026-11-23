import { readAgentSettings } from "../runs/invocations/local_ai_settings";
import type { ClaimedWorkflowNodeJob } from "../runs/jobs/worker_browser_jobs";
import { abortable, executeWorkflowNodeOnDevice } from "../runs/jobs/worker_execute";
import type { RunDeviceContext as RunContext, RunEntry } from "./run_contexts";

type Job = ClaimedWorkflowNodeJob["job"];

export const deviceJobMs = 5 * 60_000;
export const browserRunMs = 170_000;
export const browserSessionMs = 30_000;

export function buildDeviceJob(args: {
  entry: RunEntry;
  context: RunContext;
  callId: string;
  node: string;
  operation: string;
  input: unknown;
  config: Record<string, unknown>;
  waitMs?: number;
}): Job {
  const { entry, context, callId, node, operation, input, config, waitMs = deviceJobMs } = args;
  const deadline = new Date(
    Math.min(Date.now() + waitMs, Date.parse(context.expiresAt)),
  ).toISOString();
  return {
    ...(entry.spaceId ? { spaceId: entry.spaceId } : {}),
    id: `devicejob_${crypto.randomUUID()}`,
    runId: entry.runId,
    nodeId: `${node}_${callId}`,
    callId,
    scopeId: context.opaqueRef,
    operation,
    contextId: context.id,
    attempt: 1,
    controlVersion: 2,
    deadlineAt: deadline,
    leaseExpiresAt: deadline,
    input,
    config: {
      ...config,
      contextId: context.id,
      contextCapabilities: context.capabilities,
      contextExpiresAt: context.expiresAt,
      ...(context.runGrant ? { runGrant: context.runGrant } : {}),
    },
  };
}

type JobOutcome =
  { ok: true; output: Record<string, unknown> } | { ok: false; error: unknown; stopped: boolean };

export async function settleDeviceJob(job: Job, signal: AbortSignal): Promise<JobOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("device_execution_expired")),
    Math.max(0, Date.parse(job.deadlineAt ?? "") - Date.now()) || 0,
  );
  const stop = () => controller.abort(signal.reason ?? new Error("device_execution_stopped"));
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  try {
    const output = await abortable(
      executeWorkflowNodeOnDevice(job, controller.signal, () => job.leaseExpiresAt),
      controller.signal,
    );
    return { ok: true, output };
  } catch (error) {
    return { ok: false, error, stopped: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

interface AccountAgentSettings {
  screen_location?: string;
}

export const agentSettings = (): Promise<AccountAgentSettings | null> =>
  readAgentSettings().catch(() => null);

export function browserToolConfig(entry: RunEntry, policyCall?: string): Record<string, unknown> {
  return {
    agentId: entry.agentId || "misty-unified",
    ...(policyCall ? { policyCall } : {}),
  };
}
