import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { browserHomeUrl } from "@/features/app-windows";
import { devicesNative } from "@/features/devices";
import { browserTabAgentFileCapabilities } from "../../tabs/browser_tab_capabilities";
import {
  addHostedChildViews,
  hostedSessionForTask,
} from "../hosted-sessions/hosted_sessions_state";
import { useLocalExecution } from "../local-execution/local_execution";
import { ensureAgentDevice } from "../../personal/use_agent_device_store";
import { agentsDeviceSnapshot } from "../../personal/use_agents_store";
import { DeviceOperationNotAttempted, type ClaimedWorkflowNodeJob } from "./worker_browser_jobs";
import { agentPageBounds, trackAgentTab } from "../../tabs/agent_tabs";

export const childTabCapabilities = browserTabAgentFileCapabilities.filter(
  (capability) => capability !== "browser.spawn_tabs",
);

const maxChildTabs = 4;

export async function spawnChildTabs(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const config = (job.config ?? {}) as { taskId?: string; agentId?: string };
  const input = (job.input ?? {}) as { count?: number; labels?: unknown };
  const labels = Array.isArray(input.labels) ? input.labels.map((label) => String(label)) : [];
  const local = useLocalExecution.getState().execution;
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
  const snapshot = await agentsDeviceSnapshot();
  if (!snapshot.device || snapshot.device.status === "revoked")
    throw new DeviceOperationNotAttempted(new Error("device_unavailable"));
  const device = await ensureAgentDevice(snapshot.device);
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
          agentRunId: job.runId,
          ...agentPageBounds(),
        },
      });
      created.push({ id, scopeId });
      await invoke("agent_workspace_bind_scope", { taskId: execution.taskId, scopeId });
      await invoke("browser_webview_hide", { request: { id, keepLive: true } });
      trackAgentTab({
        scopeId,
        viewId: id,
        taskId: execution.taskId,
        runId: job.runId,
        conversationId: hosted?.conversationId,
        view: { id: scopeId, label: labels[index] || `Helper ${index + 1}` },
      });
    }
    if (!running()) throw new Error("agent_task_paused");
    const grants = await devicesNative.signRunGrants(
      created.map(({ scopeId }) => ({
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
          ...(hosted ? { remote_session: true, task_id: execution.taskId } : {}),
        },
        run_grant: grants[index],
      })),
    };
  } catch (error) {
    await Promise.allSettled(
      created.map(({ id }) => invoke("browser_webview_close", { request: { id } })),
    );
    if (error instanceof DeviceOperationNotAttempted) throw error;
    throw new DeviceOperationNotAttempted(error);
  }
}
