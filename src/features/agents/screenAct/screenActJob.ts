import { invoke } from "@tauri-apps/api/core";
import { DeviceOperationNotAttempted } from "../workerBrowserJobs";
import { planScreenAction, type ScreenFrame } from "./screenActPlanner";
import { screenSurface, surfaceAdapter } from "./screenActSurface";

/** The device job the server queues for one browser_act goal. */
export interface ScreenActJob {
  id: string;
  scopeId: string;
  contextId?: string;
  deadlineAt?: string;
  input: unknown;
  config: unknown;
}

export interface ScreenActResult extends Record<string, unknown> {
  status: "done" | "incomplete" | "needs_confirmation";
  summary: string;
  actions: number;
  cursor?: { x: number; y: number };
  image?: ScreenFrame["image"];
}

const actionLimit = 24;
// A malformed planner reply is shown to the planner and retried this often.
const invalidReplyLimit = 2;
// Actions in a row after which an unchanged screenshot ends the goal.
const unchangedLimit = 3;
// Stays inside the server's five-minute tool call.
const timeLimitMs = 4 * 60_000;

function parseJob(job: ScreenActJob) {
  const input = (job.input ?? {}) as { goal?: unknown; allowConsequential?: unknown };
  const config = (job.config ?? {}) as { agentId?: unknown; taskId?: unknown };
  const goal = typeof input.goal === "string" ? input.goal.trim() : "";
  const agentId = typeof config.agentId === "string" ? config.agentId : "";
  if (!goal || !agentId || !job.contextId || !job.scopeId) throw new Error("invalid_browser_grant");
  return {
    goal,
    agentId,
    taskId: typeof config.taskId === "string" ? config.taskId : undefined,
    allowConsequential: input.allowConsequential === true,
    surface: screenSurface(job.config),
  };
}

function isInvalidPlannerReply(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  // Reasoning models can also spend the whole output cap and return nothing.
  return /parse error|Invalid parameters|unsupported_screen_action|ZodError|invalid_type|empty content/i.test(
    message,
  );
}

/**
 * Runs one goal locally: capture, ask Midscene for the next action, move the
 * agent cursor and act, repeat. Every step uses Misty's native operations for
 * the job's surface (a browser page, the Misty window or the desktop) under a
 * grant scoped to this job, so leases, Stop and takeover apply to each action.
 */
export async function runScreenAct(
  job: ScreenActJob,
  signal: AbortSignal,
): Promise<ScreenActResult> {
  const { goal, agentId, taskId, allowConsequential, surface } = parseJob(job);
  const adapter = surfaceAdapter(surface);
  const runtimeId = await invoke<string>("browser_runtime_for_scope", { scopeId: job.scopeId });
  const grantId = `${job.contextId}:${job.id}:act`;
  const expiresAt = new Date(
    Math.min(Date.now() + timeLimitMs + 30_000, Date.parse(job.deadlineAt ?? "") || Infinity),
  ).toISOString();
  await invoke("browser_agent_grant_register", {
    request: {
      id: runtimeId,
      scopeId: job.scopeId,
      grantId,
      agentId,
      capabilities: adapter.capabilities,
      expiresAt,
    },
  });
  const execute = <T>(operation: string, input: Record<string, unknown>) =>
    invoke<T>("browser_agent_execute", {
      request: {
        scopeId: job.scopeId,
        grantId,
        agentId,
        operation,
        input: { ...input, __mistyTaskId: taskId },
      },
    });
  const started = Date.now();
  const history: string[] = [];
  let cursor: { x: number; y: number } | undefined;
  let frame: ScreenFrame | undefined;
  let dispatched = false;
  let calls = 0;
  let invalidReplies = 0;
  // The frame an action was planned on, to notice when the screen ignores it.
  let acted: { image: string; description: string } | undefined;
  let unchanged = 0;
  try {
    for (let step = 0; ; step++) {
      signal.throwIfAborted();
      frame = await execute<ScreenFrame>(adapter.visual, {});
      if (!frame?.documentId || !frame.image?.dataUrl)
        throw new Error("The screen did not return a usable screenshot.");
      const finish = (status: ScreenActResult["status"], summary: string): ScreenActResult => ({
        status,
        summary,
        actions: step,
        cursor,
        image: frame!.image,
      });
      if (acted) {
        unchanged = frame.image.dataUrl === acted.image ? unchanged + 1 : 0;
        if (unchanged >= unchangedLimit)
          return finish(
            "incomplete",
            `The screen did not respond after ${unchanged} tries at: ${acted.description}.`,
          );
        if (unchanged)
          history.push(
            `The screenshot did not change after "${acted.description}". Try something different or report that you cannot finish.`,
          );
        acted = undefined;
      }
      if (step >= actionLimit || Date.now() - started > timeLimitMs)
        return finish("incomplete", `Stopped after ${step} actions without reaching the goal.`);
      let plan: Awaited<ReturnType<typeof planScreenAction>>;
      try {
        plan = await planScreenAction(job.id, calls++, frame, goal, history, surface);
      } catch (error) {
        if (!isInvalidPlannerReply(error) || ++invalidReplies > invalidReplyLimit) throw error;
        history.push(
          `Your last reply was invalid (${String((error as Error).message).slice(0, 200)}). Reply again with every required parameter.`,
        );
        step--;
        continue;
      }
      if (!plan.action)
        return finish(plan.complete ? "done" : "incomplete", plan.message.slice(0, 800));
      if (plan.consequential && !allowConsequential)
        return finish(
          "needs_confirmation",
          `Stopped before a consequential action: ${plan.description}. Ask the user, then call again with allowConsequential if they agree.`,
        );
      const description = plan.description ?? "the last action";
      const mapped = adapter.input(plan.action, {
        documentId: frame.documentId,
        consequential: plan.consequential === true,
        description,
      });
      if ("unsupported" in mapped) {
        if (++invalidReplies > invalidReplyLimit)
          return finish(
            "incomplete",
            `This screen cannot do what the goal needs: ${mapped.unsupported}`,
          );
        history.push(mapped.unsupported);
        step--;
        continue;
      }
      signal.throwIfAborted();
      dispatched = true;
      const result = await execute<{ cursor?: { x: number; y: number } }>(
        adapter.interact,
        mapped.input,
      );
      acted = { image: frame.image.dataUrl, description };
      cursor = result?.cursor ?? adapter.cursor(plan.action) ?? cursor;
      const at = cursor ? ` Cursor now at (${cursor.x.toFixed(3)}, ${cursor.y.toFixed(3)}).` : "";
      history.push(
        `${description}: input dispatched.${at} Check the next screenshot for its effect.`,
      );
    }
  } catch (error) {
    // Before the first input nothing on the screen changed, so the task may retry.
    throw dispatched ? error : new DeviceOperationNotAttempted(error);
  } finally {
    await invoke("browser_agent_grant_revoke", { request: { id: runtimeId, grantId } }).catch(
      () => undefined,
    );
  }
}
