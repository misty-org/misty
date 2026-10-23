import { agentMethodsApi, type AgentMethod } from "@/api/ai/agent-methods";
import { aiSurfaceApi } from "@/features/ai-surface/api";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { desktopDeviceGrants } from "../deviceGrants";
import { holdAwake, releaseAwake } from "../keepAwake";
import { useWorkflowSchedulesStore } from "./useWorkflowSchedulesStore";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";
import { ensureServerAgentDevice } from "../store/useAgentDeviceStore";

/**
 * Scheduled tasks that drive the browser (roadmap C1). A schedule that names
 * this computer waits on the server until Misty is open here; this picks those
 * runs up and starts them with this computer's signed browser grant. A run
 * that came due while the computer was away starts late, and its conversation
 * says so. Nothing here runs in the cloud.
 */

/** This computer's id on the account, or null outside the desktop app. */
export async function thisComputerDeviceId(): Promise<string | null> {
  if (!hasTauriInternals()) return null;
  const local = await agentsDeviceSnapshot().catch(() => null);
  if (!local?.device || local.device.status === "revoked") return null;
  const device = await ensureServerAgentDevice(local.device).catch(() => null);
  return device?.id ?? null;
}

/** How long before a run this computer stays awake for it. */
const awakeAheadMs = 15 * 60_000;

/**
 * Keeps this computer awake when one of its scheduled runs is due soon or
 * waiting, under the Settings › Agents keep-awake switch.
 */
async function holdAwakeForSchedules(deviceId: string) {
  const now = Date.now();
  const soon = useWorkflowSchedulesStore
    .getState()
    .runs.some(
      (run) =>
        run.enabled &&
        run.device_id === deviceId &&
        (run.state === "awaiting_device" ||
          run.state === "device_claimed" ||
          (run.next_run_at !== undefined && Date.parse(run.next_run_at) - now < awakeAheadMs)),
    );
  await (soon ? holdAwake("schedule") : releaseAwake("schedule"));
}

let running: Promise<void> | null = null;

/** Starts every scheduled run waiting for this computer. Safe to call often. */
export function startWaitingScheduledRuns(accountId: string): Promise<void> {
  running ??= pickUp(accountId).finally(() => {
    running = null;
  });
  return running;
}

async function pickUp(accountId: string) {
  const deviceId = await thisComputerDeviceId();
  if (!deviceId || useMistyStore.getState().accountId !== accountId) return;
  await holdAwakeForSchedules(deviceId).catch(() => {});
  const { runs } = await agentMethodsApi.deviceRuns(deviceId).catch(() => ({ runs: [] }));
  const methods = new Map<string, AgentMethod[]>();
  for (const run of runs) {
    if (useMistyStore.getState().accountId !== accountId) return;
    if (!methods.has(run.agent_id))
      methods.set(
        run.agent_id,
        (await agentMethodsApi.list(run.agent_id).catch(() => ({ methods: [] }))).methods,
      );
    const method = methods.get(run.agent_id)?.find((item) => item.id === run.method_id);
    if (!method) continue;
    const target = method.definition.target;
    // A workflow that needs a Misty window waits for the current task to end.
    if (target !== "cloud" && useMistyStore.getState().working) continue;
    const claim = await agentMethodsApi.claimDeviceRun(run.id, deviceId).catch(() => null);
    if (!claim) continue;
    try {
      if (target === "cloud") {
        await aiSurfaceApi.createInvocation({
          mode: "drawer",
          surfaceId: "global",
          trigger: "scheduled_task",
          prompt: claim.title || method.definition.title,
          context: [],
          agentId: claim.agent_id,
          conversationId: claim.conversation_id,
          methodVersionId: claim.method_version_id,
          methodInputs: claim.inputs,
          scheduleId: claim.schedule_id,
          scheduleClaim: claim.claim,
          deviceContexts: await desktopDeviceGrants(null),
          executionMode: "user",
          idempotencyKey: claim.idempotency_key,
          timezone: claim.timezone,
        });
      } else {
        useMistyStore.setState({ selectedAgentId: claim.agent_id });
        await useMistyStore.getState().submitAnswer(
          claim.title || method.definition.title,
          [],
          undefined,
          "workspace",
          [],
          { conversationId: claim.conversation_id, context: [] },
          {
            executionMode: "agent",
            methodVersionId: claim.method_version_id,
            methodInputs: claim.inputs,
            idempotencyKey: claim.idempotency_key,
            schedule: { id: claim.schedule_id, claim: claim.claim },
          },
        );
      }
    } catch {
      // The claim lapses in ten minutes and the run is offered again.
    }
  }
}
