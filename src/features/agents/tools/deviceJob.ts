import { readAgentSettings } from "../runs/invocations/localAiSettings";
import type { ClaimedWorkflowNodeJob } from "../runs/jobs/workerBrowserJobs";
import { abortable, executeWorkflowNodeOnDevice } from "../runs/jobs/workerExecute";
import type { RunDeviceContext as RunContext, RunEntry } from "./runContexts";

/**
 * One device job on this computer, in the envelope the worker receives from the server, so the code
 * that does the work (workerExecute.ts) can't tell where it came from.
 */
type Job = ClaimedWorkflowNodeJob["job"];

/** The server's `deviceJobDeadline`. Native code refuses a deadline over 301 seconds away. */
export const deviceJobMs = 5 * 60_000;
/** A program has two minutes on the device, plus time to report (`browserRunWait`). */
export const browserRunMs = 170_000;
/** A computer that doesn't open a session by then counts as offline (`remoteSessionWait`). */
export const browserSessionMs = 30_000;

export function buildDeviceJob(args: {
  entry: RunEntry;
  context: RunContext;
  callId: string;
  /** Names the job in its run, as the server does: `browser_tool`, `device_tool` and so on. */
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
    scopeId: context.opaqueRef,
    operation,
    contextId: context.id,
    attempt: 1,
    controlVersion: 2,
    deadlineAt: deadline,
    // Nothing renews it here, so it runs as long as the job may.
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

export type JobOutcome =
  | { ok: true; output: Record<string, unknown> }
  /** `stopped`: its time ran out or its run stopped, so nobody saw how it ended. */
  | { ok: false; error: unknown; stopped: boolean };

/** Runs the job to its deadline. The operation itself is never repeated. */
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

export interface AccountAgentSettings {
  screen_location?: string;
}

/** Where this computer opens a screen. */
export const agentSettings = (): Promise<AccountAgentSettings | null> =>
  readAgentSettings().catch(() => null);

/**
 * The agent, and which tool call this job belongs to. Native code finds the run through that call, and
 * reads its mode, the sites agents may not act on and what was remembered itself (`tool_gate.rs`).
 */
export function browserToolConfig(entry: RunEntry, policyCall?: string): Record<string, unknown> {
  return {
    agentId: entry.agentId || "misty-unified",
    ...(policyCall ? { policyCall } : {}),
  };
}
