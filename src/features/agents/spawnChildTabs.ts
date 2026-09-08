import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { resolveApiBase } from "@/api/deployment/api";
import { useUserStore } from "@/features/auth/core";
import { browserHomeUrl } from "@/features/workspace/browserHome";
import { devicesNative } from "@/native/devices";
import { browserTabAgentFileCapabilities } from "./browserTabCapabilities";
import { addHostedChildViews, hostedSessionForTask } from "./hostedSessionsState";
import { useLocalExecution } from "./localExecution";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import { DeviceOperationNotAttempted, type ClaimedWorkflowNodeJob } from "./workerBrowserJobs";

/** What a sub-agent may do in its tab: everything but start sub-agents. */
export const childTabCapabilities = browserTabAgentFileCapabilities.filter(
  (capability) => capability !== "browser.spawn_tabs",
);

const maxChildTabs = 4;

/**
 * browser.spawn_tabs: opens one browser tab per sub-agent for the running task
 * (docs/plans/agentic-browser.md, Phase 4). Each tab is bound to the task's
 * lease, so Stop and takeover end the sub-agents too, and this device signs
 * each sub-agent's grant itself: the server only carries it.
 */
export async function spawnChildTabs(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const config = (job.config ?? {}) as { taskId?: string; agentId?: string };
  const input = (job.input ?? {}) as { count?: number };
  const local = useLocalExecution.getState().execution;
  // The parent works either in this computer's own task or in a session it
  // runs for another device's request.
  const hosted = config.taskId ? hostedSessionForTask(config.taskId) : undefined;
  const execution =
    local && local.state === "running" && local.taskId === config.taskId
      ? { taskId: local.taskId, spaceId: local.spaceId }
      : hosted
        ? { taskId: hosted.taskId, spaceId: "" }
        : undefined;
  const count = Math.trunc(Number(input.count));
  if (!execution || !config.taskId || !Number.isFinite(count) || count < 1 || count > maxChildTabs)
    throw new DeviceOperationNotAttempted(new Error("agent_task_paused"));
  const running = () =>
    hosted
      ? Boolean(hostedSessionForTask(execution.taskId))
      : useLocalExecution.getState().execution?.taskId === execution.taskId &&
        useLocalExecution.getState().execution?.state === "running";
  const accountId = useUserStore.getState().me?.id;
  const snapshot = await agentsDeviceSnapshot();
  if (!accountId || !snapshot.device || snapshot.device.status === "revoked")
    throw new DeviceOperationNotAttempted(new Error("device_unavailable"));
  const device = await ensureServerAgentDevice(snapshot.device);
  const windowLabel = getCurrentWindow().label;
  const created: Array<{ id: string; scopeId: string }> = [];
  try {
    for (let index = 0; index < count; index++) {
      signal.throwIfAborted();
      const id = `agent-${crypto.randomUUID()}`;
      const scopeId = `agent-scope-${crypto.randomUUID()}`;
      await invoke("browser_webview_create", {
        request: {
          id,
          scopeId,
          url: browserHomeUrl(),
          originSpaceId: execution.spaceId,
          x: 0,
          y: 64,
          width: Math.max(200, window.innerWidth - 440),
          height: Math.max(300, window.innerHeight - 128),
          theme: "dark",
        },
      });
      created.push({ id, scopeId });
      await invoke("agent_workspace_bind_scope", { taskId: execution.taskId, scopeId });
      await invoke("browser_webview_hide", { request: { id } });
    }
    // The task may have stopped while the tabs opened.
    if (!running()) throw new Error("agent_task_paused");
    const grants = await devicesNative.signRunGrants(
      { apiBase: await resolveApiBase(), accountId },
      created.map(({ scopeId }) => ({
        targetDeviceId: device.id,
        agentId: config.agentId ?? "",
        capabilities: [...childTabCapabilities].sort(),
        scopes: [scopeId],
      })),
    );
    if (hosted)
      addHostedChildViews(
        execution.taskId,
        created.map(({ id }) => id),
      );
    else {
      const current = useLocalExecution.getState().execution!;
      useLocalExecution.setState({
        execution: {
          ...current,
          childViews: [...(current.childViews ?? []), ...created.map(({ id }) => id)],
        },
      });
    }
    return {
      tabs: created.map(({ scopeId }, index) => ({
        device_id: device.id,
        kind: "browser_tab",
        opaque_ref: scopeId,
        display_name: `Sub-agent ${index + 1}`,
        capabilities: childTabCapabilities,
        metadata: {
          kind: "browser_tab",
          app_id: "browser",
          label: `Sub-agent ${index + 1}`,
          window_label: windowLabel,
          agentOwned: true,
          delegated: true,
          // A session for another device's request: its task holds the lease.
          ...(hosted ? { remote_session: true, task_id: execution.taskId } : {}),
        },
        run_grant: grants[index],
      })),
    };
  } catch (error) {
    // Nothing is handed to the server, so no tab may outlive this failure.
    await Promise.allSettled(
      created.map(({ id }) => invoke("browser_webview_close", { request: { id } })),
    );
    if (error instanceof DeviceOperationNotAttempted) throw error;
    throw new DeviceOperationNotAttempted(error);
  }
}
