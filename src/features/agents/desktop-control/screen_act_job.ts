import "./process_shim";
import { invoke } from "@tauri-apps/api/core";
import { Agent } from "@midscene/core/agent";
import { DeviceOperationNotAttempted, jobPolicyCall } from "../runs/jobs/worker_browser_jobs";
import { actionContexts } from "./screen_actions";
import { MistyScreenDevice, type ScreenFrame } from "./screen_device";
import { screenModelClient, screenModelConfig } from "./screen_model";
import { screenSurface, surfaceAdapter } from "./screen_act_surface";

interface ScreenActJob {
  id: string;
  scopeId: string;
  contextId?: string;
  deadlineAt?: string;
  input: unknown;
  config: unknown;
}

interface ScreenActResult extends Record<string, unknown> {
  status: "done" | "incomplete" | "needs_confirmation";
  summary: string;
  actions: number;
  cursor?: { x: number; y: number };
  image?: ScreenFrame["image"];
}

const planLimit = 70;
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

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("time_limit")), timeLimitMs);
  const device = new MistyScreenDevice({
    surface,
    adapter,
    allowConsequential,
    controller,
    execute: (operation, input) =>
      invoke("browser_agent_execute", {
        request: {
          scopeId: job.scopeId,
          grantId,
          agentId,
          operation,
          input: { ...input, __mistyTaskId: taskId },
          policyCall: jobPolicyCall(job.config),
        },
      }),
  });
  const model = screenModelClient();
  const finish = (status: ScreenActResult["status"], summary: string): ScreenActResult => ({
    status,
    summary: summary.slice(0, 800),
    actions: device.actions.length,
    cursor: device.cursor,
    image: device.frame?.image,
  });
  const progress = () =>
    device.actions.length
      ? ` Did ${device.actions.length} actions, most recently: ${device.actions.slice(-3).join("; ")}. Call again with the same goal to continue.`
      : "";
  try {
    const agent = new Agent(device, {
      generateReport: false,
      autoPrintReportMsg: false,
      persistExecutionDump: false,
      modelConfig: screenModelConfig,
      createOpenAIClient: model.createOpenAIClient,
      aiContexts: { aiAct: actionContexts[surface] },
      replanningCycleLimit: planLimit,
      waitAfterAction: 0,
    });
    const message = await agent.aiAct(goal, { abortSignal: controller.signal });
    return finish("done", message?.trim() || "The goal is visible on the screen.");
  } catch (error) {
    if (device.stop) return finish(device.stop.status, device.stop.summary);
    if (signal.aborted) throw error;
    if (device.failure)
      throw device.dispatched ? device.failure : new DeviceOperationNotAttempted(device.failure);
    if (controller.signal.aborted)
      return finish("incomplete", `Stopped at the four-minute limit.${progress()}`);
    const declined = /Task failed:\s*([^\n]*)/.exec(messageOf(error))?.[1];
    if (!device.dispatched && declined === undefined) throw new DeviceOperationNotAttempted(error);
    return finish("incomplete", `${declined ?? messageOf(error).split("\n")[0]}${progress()}`);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    await invoke("browser_agent_grant_revoke", { request: { id: runtimeId, grantId } }).catch(
      () => undefined,
    );
  }
}
