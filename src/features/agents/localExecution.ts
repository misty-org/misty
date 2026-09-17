import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { personalAgentsApi } from "@/api/agents/native";
import { apiRequest, resolveRequiredApiBase } from "@/api/client";
import { browserProfileId } from "@/features/apps/rpc/browserIdentity";
import { assignedIntegrationDestinations } from "./integrationDestinations";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";
import type { AiInvocationDeviceContext } from "@/features/ai-surface";
import type { GlobalAiContextRef } from "@/features/global-search/types";

export const agentWorkerParameters = new URLSearchParams(
  typeof location === "undefined" ? "" : location.search,
);
export const isAgentWorkerWindow = () =>
  hasTauriInternals() && getCurrentWindow().label.startsWith("misty-agent-");
export interface Execution {
  taskId: string;
  accountId: string;
  agentId: string;
  spaceId: string;
  mode: "agent" | "team";
  state: "running" | "paused" | "finished";
  views: string[];
  context: GlobalAiContextRef[];
  deviceContexts: AiInvocationDeviceContext[];
}
export const useLocalExecution = create<{ execution: Execution | null }>(() => ({
  execution: null,
}));
let heartbeat: ReturnType<typeof setInterval> | undefined;
let generation = 0;
const remoteLease = (e: Execution, renew = false) =>
  apiRequest("/misty/agent-execution", {
    method: "POST",
    body: JSON.stringify({
      agent_id: e.agentId,
      space_id: e.spaceId,
      task_id: e.taskId,
      window_label: getCurrentWindow().label,
      renew,
    }),
  });
const releaseLease = async (e: Execution) => {
  // Attempt both boundaries even when connectivity is lost. Server authority expires independently.
  await Promise.allSettled([
    invoke("agent_workspace_release", { taskId: e.taskId }),
    apiRequest(`/misty/agent-execution/${encodeURIComponent(e.taskId)}`, { method: "DELETE" }),
  ]);
};
const lease = (execution: Execution) => ({
  accountId: execution.accountId,
  agentId: execution.agentId,
  spaceId: execution.spaceId,
  taskId: execution.taskId,
});

export async function startLocalExecution(
  accountId: string,
  agentId: string,
  spaceId: string,
  mode: "agent" | "team",
) {
  if (!hasTauriInternals() || !/Mac|Win/.test(navigator.platform))
    throw new Error("Agent execution requires Misty on macOS or Windows.");
  let previous = useLocalExecution.getState().execution;
  if (
    previous?.state === "finished" &&
    (previous.agentId !== agentId || previous.spaceId !== spaceId)
  ) {
    await finishLocalExecution();
    previous = null;
  }
  if (
    previous &&
    (previous.accountId !== accountId ||
      previous.agentId !== agentId ||
      previous.spaceId !== spaceId)
  )
    throw new Error("Stop the current task before changing its agent or Space.");
  if (previous?.state === "running")
    throw new Error("Pause the active task before starting another request.");
  const epoch = ++generation;
  const execution: Execution = {
    taskId: crypto.randomUUID(),
    accountId,
    agentId,
    spaceId,
    mode,
    state: "running",
    views: [...(previous?.views ?? [])],
    context: [...(previous?.context ?? [])],
    deviceContexts: [...(previous?.deviceContexts ?? [])],
  };
  const assertCurrent = () => {
    if (generation !== epoch || useLocalExecution.getState().execution?.taskId !== execution.taskId)
      throw new Error("Task paused before its next action.");
  };
  useLocalExecution.setState({ execution: { ...execution } });
  try {
    if (previous) await releaseLease(previous);
    assertCurrent();
    await remoteLease(execution);
    assertCurrent();
    await invoke("agent_workspace_acquire", { request: lease(execution) });
    assertCurrent();
    clearInterval(heartbeat);
    let lastTick = Date.now();
    heartbeat = setInterval(() => {
      const now = Date.now();
      if (now - lastTick > 25000) {
        void pauseLocalExecution(execution.taskId);
        return;
      }
      lastTick = now;
      void remoteLease(execution, true)
        .then(() =>
          invoke("agent_workspace_acquire", { request: { ...lease(execution), renew: true } }),
        )
        .catch(() => void pauseLocalExecution(execution.taskId));
    }, 10000);
    await (await import("./taskArtifacts")).trackTaskArtifacts(accountId);
    assertCurrent();
    const assigned = await personalAgentsApi.apps(agentId, spaceId);
    assertCurrent();
    if (previous) {
      const valid = new Set(assigned.app_ids);
      const discarded = execution.deviceContexts.filter(
        (ref) => !valid.has(String(ref.metadata?.app_id ?? "")),
      );
      for (const ref of discarded) {
        const index = execution.deviceContexts.indexOf(ref);
        await invoke("browser_webview_close", { request: { id: execution.views[index] } });
        execution.views.splice(index, 1);
        execution.context.splice(index, 1);
        execution.deviceContexts.splice(index, 1);
      }
      for (const ref of execution.deviceContexts) {
        assertCurrent();
        await invoke("agent_workspace_bind_scope", {
          taskId: execution.taskId,
          scopeId: ref.opaqueRef,
        });
      }
    }
    if (!previous) {
      const destinations = await assignedIntegrationDestinations(
        accountId,
        spaceId,
        assigned.app_ids,
      );
      if (destinations.length > 50)
        throw new Error("This task has more than 50 website accounts. Reduce its assigned apps.");
      if (destinations.length) {
        const snapshot = await agentsDeviceSnapshot();
        if (!snapshot.device) throw new Error("This device is unavailable for agent execution.");
        const device = await ensureServerAgentDevice(snapshot.device);
        const base = await resolveRequiredApiBase();
        for (const destination of destinations) {
          assertCurrent();
          const id = `agent-${crypto.randomUUID()}`,
            scopeId = `agent-scope-${crypto.randomUUID()}`;
          const profileId = await browserProfileId(base, accountId, destination.appId, {
            id: destination.providerId,
            accountId: destination.accountId,
          });
          await invoke("browser_webview_create", {
            request: {
              id,
              scopeId,
              url: destination.url,
              profileId,
              providerId: destination.providerId,
              profileProviderId: destination.providerId,
              originSpaceId: spaceId,
              x: 0,
              y: 64,
              width: Math.max(200, window.innerWidth - 440),
              height: Math.max(300, window.innerHeight - 128),
              theme: "dark",
            },
          });
          execution.views.push(id);
          if (generation !== epoch) {
            await invoke("browser_webview_close", { request: { id } });
            assertCurrent();
          }
          await invoke("agent_workspace_bind_scope", { taskId: execution.taskId, scopeId });
          await invoke("browser_webview_hide", { request: { id } });
          execution.context.push({
            kind: "browser-tab",
            id: destination.id,
            title: destination.label,
            source: "current",
            privacy: "device",
            spaceId,
            opaqueScopeId: scopeId,
            attached: true,
            metadata: { app_id: destination.appId },
          });
          execution.deviceContexts.push({
            deviceId: device.id,
            kind: "browser_tab",
            opaqueRef: scopeId,
            displayName: `${destination.label} (${destination.appId})`,
            capabilities: [
              "browser.inspect",
              "browser.visual",
              "browser.navigate",
              "browser.click",
              "browser.interact",
              "browser.downloads.list",
              "browser.upload",
            ],
            metadata: {
              app_id: destination.appId,
              provider_id: destination.providerId,
              profile_id: profileId,
              window_label: getCurrentWindow().label,
            },
          });
        }
      }
    }
    assertCurrent();
    useLocalExecution.setState({ execution: { ...execution } });
    return execution;
  } catch (error) {
    await releaseLease(execution);
    if (generation === epoch) await settleLocalExecution("paused", execution.taskId);
    throw error;
  }
}
export async function pauseLocalExecution(expectedTaskId?: string) {
  const execution = useLocalExecution.getState().execution;
  if (!execution || (expectedTaskId && execution.taskId !== expectedTaskId)) return;
  ++generation;
  clearInterval(heartbeat);
  heartbeat = undefined;
  useLocalExecution.setState({ execution: { ...execution, state: "paused" } });
  const { useMistyStore } = await import("@/features/misty/useMistyStore");
  const { replaceActiveGlobalInvocationStream } =
    await import("@/features/global-search/globalSearchStoreHelpers");
  const invocationId = useMistyStore.getState().invocationId;
  replaceActiveGlobalInvocationStream();
  useMistyStore.setState({ working: false, invocationId: undefined });
  await releaseLease(execution);
  if (invocationId) {
    const { aiSurfaceApi } = await import("@/features/ai-surface/api");
    await aiSurfaceApi.cancelInvocation(invocationId).catch(() => {});
  }
}
export async function finishLocalExecution() {
  const execution = useLocalExecution.getState().execution;
  if (!execution) return;
  await pauseLocalExecution(execution.taskId);
  if (useLocalExecution.getState().execution?.taskId !== execution.taskId) return;
  useLocalExecution.setState({ execution: null });
  await Promise.allSettled(
    execution.views.map((id) => invoke("browser_webview_close", { request: { id } })),
  );
}

/** Quiesce only this task; a late completion must never release its successor. */
export async function settleLocalExecution(
  state: "paused" | "finished" = "finished",
  expectedTaskId?: string,
) {
  const execution = useLocalExecution.getState().execution;
  if (!execution || (expectedTaskId && execution.taskId !== expectedTaskId)) return;
  ++generation;
  clearInterval(heartbeat);
  heartbeat = undefined;
  // Publish the stopped state before awaiting release so a successor sees a quiesced task.
  useLocalExecution.setState({ execution: { ...execution, state } });
  await releaseLease(execution);
}
export async function steerLocalExecution(prompt: string) {
  const { useMistyStore } = await import("@/features/misty/useMistyStore");
  const before = useMistyStore.getState();
  await pauseLocalExecution();
  const { replaceActiveGlobalInvocationStream } =
    await import("@/features/global-search/globalSearchStoreHelpers");
  replaceActiveGlobalInvocationStream();
  useMistyStore.setState({
    working: false,
    selectedSpaceId: useLocalExecution.getState().execution?.spaceId ?? before.selectedSpaceId,
  });
  await useMistyStore.getState().submitAnswer(prompt);
}

export async function routeLocalFollowup(prompt: string): Promise<string> {
  const { useMistyStore } = await import("@/features/misty/useMistyStore");
  const execution = useLocalExecution.getState().execution;
  const conversationId = useMistyStore.getState().activeConversationId;
  if (!execution || !conversationId) throw new Error("Open the active task conversation first.");
  await pauseLocalExecution(execution.taskId);
  const routingGeneration = generation;
  const { route } = await apiRequest<{ route: "steer" | "queue" | "stop" }>(
    "/misty/agent-followup",
    {
      method: "POST",
      body: JSON.stringify({
        agent_id: execution.agentId,
        conversation_id: conversationId,
        prompt,
      }),
    },
  );
  if (
    generation !== routingGeneration ||
    useLocalExecution.getState().execution?.taskId !== execution.taskId ||
    useMistyStore.getState().accountId !== execution.accountId
  )
    throw new Error("The active task changed. The follow-up was not applied.");
  if (route === "stop") return "Stopped. Completed changes have not been undone.";
  if (route === "queue") {
    await invoke("agent_foreground_queue", {
      task: {
        accountId: execution.accountId,
        agentId: execution.agentId,
        spaceId: execution.spaceId,
        mode: execution.mode,
        prompt,
      },
    });
    await steerLocalExecution(
      "Continue the current task, preserving all earlier constraints. Inspect the current state before repeating any write.",
    );
    return "Independent request queued after this task.";
  }
  await steerLocalExecution(prompt);
  return "Follow-up applied to this task.";
}

let drainingQueue = false;
export async function continueQueuedLocalWork(expectedTaskId: string) {
  if (drainingQueue) return;
  drainingQueue = true;
  try {
    const { useMistyStore } = await import("@/features/misty/useMistyStore");
    const execution = useLocalExecution.getState().execution;
    if (
      execution?.taskId !== expectedTaskId ||
      execution.state !== "finished" ||
      useMistyStore.getState().working
    )
      return;
    const task = await invoke<{
      queueId: string;
      accountId: string;
      agentId: string;
      spaceId: string;
      mode: "agent" | "team";
      prompt: string;
    } | null>("agent_foreground_queue", {});
    if (!task || useLocalExecution.getState().execution?.taskId !== expectedTaskId) return;
    if (task.accountId !== useMistyStore.getState().accountId) return;
    await finishLocalExecution();
    useMistyStore.setState({
      selectedAgentId: task.agentId,
      selectedSpaceId: task.spaceId,
      executionMode: task.mode,
      activeConversationId: "",
      context: [],
      handoff: { spaceId: task.spaceId, context: [] },
    });
    await useMistyStore.getState().submitAnswer(task.prompt);
    if (useMistyStore.getState().invocationId)
      await invoke("agent_foreground_queue", { acknowledgeId: task.queueId });
  } finally {
    drainingQueue = false;
  }
}
