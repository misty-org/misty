import { invoke } from "@tauri-apps/api/core";
import { resolveApiBase } from "@/api/deployment/api";
import { useUserStore } from "@/features/auth/core";
import { browserHomeUrl } from "@/features/workspace/browserHome";
import { devicesNative } from "@/native/devices";
import { agentPageBounds, agentTabsForTask, trackAgentTab } from "./agentTabs";
import { browserTabAgentFileCapabilities } from "./browserTabCapabilities";
import { addHostedChildViews, type HostedSession } from "./hostedSessionsState";
import { unwrapSearchRedirect } from "./programs/searchRedirect";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import { DeviceOperationNotAttempted, type ClaimedWorkflowNodeJob } from "./workerBrowserJobs";

/** How many tabs of its own one session may hold. */
export const maxOwnTabs = 32;

/** Opens another hidden tab in a session, bound to its task, and returns the tab's scope. */
export async function openSessionTab(
  session: HostedSession,
  url: string,
  signal: AbortSignal,
): Promise<string> {
  const id = `agent-${crypto.randomUUID()}`;
  const scopeId = `agent-scope-${crypto.randomUUID()}`;
  try {
    signal.throwIfAborted();
    await invoke("browser_webview_create", {
      request: {
        id,
        scopeId,
        url,
        originSpaceId: "",
        theme: "dark",
        agentRunId: session.runId,
        ...agentPageBounds(),
      },
    });
    await invoke("agent_workspace_bind_scope", { taskId: session.taskId, scopeId });
    await invoke("browser_webview_hide", { request: { id, keepLive: true } });
    // As above: the new tab's first read waits for its page, not about:blank.
    await invoke("browser_webview_await_load", { request: { id } }).catch(() => false);
  } catch (error) {
    await invoke("browser_webview_close", { request: { id } }).catch(() => undefined);
    throw new DeviceOperationNotAttempted(error);
  }
  addHostedChildViews(session.taskId, [id], [scopeId]);
  trackAgentTab({
    scopeId,
    viewId: id,
    taskId: session.taskId,
    runId: session.runId,
    url,
    conversationId: session.conversationId,
  });
  return scopeId;
}

/** The scope of the task's tab already at `url` (hash and trailing slash aside), so a page
 * the agent opens twice is not opened twice. */
export function tabShowing(taskId: string, url: string): string | undefined {
  const key = (value: string) => {
    try {
      const parsed = new URL(value);
      parsed.hash = "";
      return parsed.href.replace(/\/$/, "");
    } catch {
      return value;
    }
  };
  return agentTabsForTask(taskId).find((tab) => tab.url && key(tab.url) === key(url))?.scopeId;
}

/** The page a tab starts on: an http(s) address, else the browser home. */
export function startUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return browserHomeUrl();
  try {
    // A search result's tracking redirect opens the page it points to (programs/searchRedirect.ts).
    const url = new URL(unwrapSearchRedirect(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : browserHomeUrl();
  } catch {
    return browserHomeUrl();
  }
}

/** A tab of the agent's own as the job's answer: its scope and the grant this device signs. */
export async function signedSessionTab(
  job: ClaimedWorkflowNodeJob["job"],
  tabScope: string,
  taskId: string,
): Promise<Record<string, unknown>> {
  const agentId = String((job.config as { agentId?: unknown } | undefined)?.agentId ?? "");
  const accountId = useUserStore.getState().me?.id ?? "";
  const snapshot = await agentsDeviceSnapshot();
  if (!snapshot.device) throw new DeviceOperationNotAttempted(new Error("device_unavailable"));
  const device = await ensureServerAgentDevice(snapshot.device);
  const [grant] = await devicesNative.signRunGrants(
    { apiBase: await resolveApiBase(), accountId },
    [
      {
        targetDeviceId: device.id,
        agentId,
        capabilities: [...browserTabAgentFileCapabilities].sort(),
        scopes: [tabScope],
      },
    ],
  );
  return {
    tabs: [
      {
        device_id: device.id,
        kind: "browser_tab",
        opaque_ref: tabScope,
        display_name: `Browser on ${snapshot.device.displayName || "this computer"}`,
        capabilities: browserTabAgentFileCapabilities,
        metadata: {
          kind: "browser_tab",
          app_id: "browser",
          label: snapshot.device.displayName || "Browser",
          agentOwned: true,
          remote_session: true,
          task_id: taskId,
        },
        run_grant: grant,
      },
    ],
  };
}
