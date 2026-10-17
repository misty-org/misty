import { cachedRequest } from "@/api/cache/cachedRequest";
import { invoke } from "@tauri-apps/api/core";
import { subscribeAccountEvents } from "@/api/accountEvents";
import { resolveApiBase } from "@/api/deployment/api";
import { useUserStore } from "@/features/auth/core";
import { browserHomeUrl } from "@/features/workspace/browserHome";
import { devicesNative } from "@/native/devices";
import { browserTabAgentFileCapabilities } from "./browserTabCapabilities";
import { holdAwake, releaseAwake } from "./keepAwake";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import { DeviceOperationNotAttempted, type ClaimedWorkflowNodeJob } from "./workerBrowserJobs";
import {
  addHostedChildViews,
  hostedSessionForTask,
  sessions,
  touchHostedSession,
  update,
  type HostedSession,
} from "./hostedSessionsState";

export {
  addHostedChildViews,
  hostedSessionForTask,
  touchHostedSession,
  useHostedSessions,
  type HostedSession,
} from "./hostedSessionsState";

const idleMs = 10 * 60_000;
const renewMs = 10_000;
const timers = new Map<string, ReturnType<typeof setInterval>>();
let unsubscribe: (() => void) | undefined;

// A hosted session is the agent's own hidden tab, so it runs beside the person's
// tasks and other sessions instead of waiting for them.
const lease = (session: Pick<HostedSession, "accountId" | "agentId" | "taskId">) => ({
  accountId: session.accountId,
  agentId: session.agentId,
  spaceId: "",
  taskId: session.taskId,
  background: true,
});

export async function endHostedSession(taskId: string): Promise<void> {
  const session = hostedSessionForTask(taskId);
  if (!session) return;
  update(sessions().filter((item) => item.taskId !== taskId));
  clearInterval(timers.get(taskId));
  timers.delete(taskId);
  await Promise.allSettled([
    invoke("agent_workspace_release", { taskId }),
    ...[session.viewId, ...session.childViews].map((id) =>
      invoke("browser_webview_close", { request: { id } }),
    ),
  ]);
  void releaseAwake(`hosted:${taskId}`);
  if (!sessions().length) {
    unsubscribe?.();
    unsubscribe = undefined;
  }
}

/** Ends every session, for example when the account signs out. */
export async function endAllHostedSessions(): Promise<void> {
  await Promise.allSettled(sessions().map((session) => endHostedSession(session.taskId)));
}

// A stopped request ends its session at once rather than after the idle limit.
function watchRequests(accountId: string) {
  if (unsubscribe) return;
  unsubscribe = subscribeAccountEvents(accountId, (event) => {
    if (event.topic !== "invocations" && event.topic !== "reset") return;
    for (const session of sessions()) {
      if (event.topic === "invocations" && event.id && event.id !== session.runId) continue;
      void cachedRequest<{ state: string }>(
        `/ai/invocations/${encodeURIComponent(session.runId)}/state`,
      )
        .then(({ state }) => {
          if (state === "canceled") void endHostedSession(session.taskId);
        })
        .catch(() => undefined);
    }
  });
}

function keepAlive(session: HostedSession) {
  clearInterval(timers.get(session.taskId));
  timers.set(
    session.taskId,
    setInterval(() => {
      const current = hostedSessionForTask(session.taskId);
      if (!current) return;
      if (
        Date.now() - current.lastUsed > idleMs ||
        useUserStore.getState().me?.id !== current.accountId
      ) {
        void endHostedSession(current.taskId);
        return;
      }
      void invoke("agent_workspace_acquire", { request: { ...lease(current), renew: true } }).catch(
        () => void endHostedSession(current.taskId),
      );
    }, renewMs),
  );
}

/** How many tabs of its own one session may hold. */
const maxOwnTabs = 16;

/** Opens another hidden tab in a session, bound to its task, and returns the tab's scope. */
async function openSessionTab(session: HostedSession, url: string, signal: AbortSignal): Promise<string> {
  const id = `agent-${crypto.randomUUID()}`;
  const scopeId = `agent-scope-${crypto.randomUUID()}`;
  try {
    signal.throwIfAborted();
    await invoke("browser_webview_create", {
      request: {
        id, scopeId, url, originSpaceId: "", x: 0, y: 64, theme: "dark",
        width: Math.max(200, window.innerWidth - 440),
        height: Math.max(300, window.innerHeight - 128),
      },
    });
    await invoke("agent_workspace_bind_scope", { taskId: session.taskId, scopeId });
    await invoke("browser_webview_hide", { request: { id, keepLive: true } });
  } catch (error) {
    await invoke("browser_webview_close", { request: { id } }).catch(() => undefined);
    throw new DeviceOperationNotAttempted(error);
  }
  addHostedChildViews(session.taskId, [id]);
  return scopeId;
}

function startUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return browserHomeUrl();
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : browserHomeUrl();
  } catch {
    return browserHomeUrl();
  }
}

/**
 * browser.session: opens (or reuses, for the same conversation) a browser
 * session here and returns its tab with a grant this device signed.
 */
export async function startHostedSession(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const config = (job.config ?? {}) as { agentId?: unknown };
  const input = (job.input ?? {}) as { url?: unknown; conversationId?: unknown; scopeId?: unknown; newTab?: unknown };
  const agentId = typeof config.agentId === "string" ? config.agentId : "";
  const conversationId = typeof input.conversationId === "string" ? input.conversationId : "";
  const accountId = useUserStore.getState().me?.id ?? "";
  if (!agentId || !accountId || input.scopeId !== job.scopeId)
    throw new DeviceOperationNotAttempted(new Error("invalid_browser_grant"));
  const snapshot = await agentsDeviceSnapshot();
  if (!snapshot.device || snapshot.device.status === "revoked")
    throw new DeviceOperationNotAttempted(new Error("device_unavailable"));
  const device = await ensureServerAgentDevice(snapshot.device);
  if (job.scopeId !== `workspace:${device.id}`)
    throw new DeviceOperationNotAttempted(new Error("invalid_browser_grant"));

  let session = sessions().find(
    (item) => item.conversationId === conversationId && conversationId && item.agentId === agentId,
  );
  if (!session) {
    const taskId = crypto.randomUUID();
    const viewId = `agent-${crypto.randomUUID()}`;
    const scopeId = `agent-scope-${crypto.randomUUID()}`;
    const fresh = { taskId, accountId, agentId };
    // One task per agent and window: busy here means the person or another
    // request is using this agent on this computer.
    await invoke("agent_workspace_acquire", { request: lease(fresh) }).catch((error) => {
      throw new DeviceOperationNotAttempted(new Error(`agent_busy: ${String(error)}`));
    });
    try {
      signal.throwIfAborted();
      await invoke("browser_webview_create", {
        request: {
          id: viewId,
          scopeId,
          url: startUrl(input.url),
          originSpaceId: "",
          x: 0,
          y: 64,
          width: Math.max(200, window.innerWidth - 440),
          height: Math.max(300, window.innerHeight - 128),
          theme: "dark",
        },
      });
      await invoke("agent_workspace_bind_scope", { taskId, scopeId });
      // Parked out of sight rather than hidden: a hidden page stops rendering, and
      // embedded widgets (schedules, booking calendars) never draw for the agent to read.
      await invoke("browser_webview_hide", { request: { id: viewId, keepLive: true } });
    } catch (error) {
      await Promise.allSettled([
        invoke("browser_webview_close", { request: { id: viewId } }),
        invoke("agent_workspace_release", { taskId }),
      ]);
      throw new DeviceOperationNotAttempted(error);
    }
    session = {
      ...fresh,
      conversationId,
      scopeId,
      viewId,
      childViews: [],
      runId: job.runId,
      lastUsed: Date.now(),
    };
    update([...sessions(), session]);
    keepAlive(session);
    watchRequests(accountId);
    void holdAwake(`hosted:${taskId}`);
  } else {
    touchHostedSession(session.scopeId, job.runId);
  }
  // Another tab of the agent's own beside the first, when the run asks to keep a page open.
  let tabScope = session.scopeId;
  if (input.newTab === true && typeof input.url === "string" && session.childViews.length < maxOwnTabs - 1)
    tabScope = await openSessionTab(session, startUrl(input.url), signal);
  try {
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
            task_id: session.taskId,
          },
          run_grant: grant,
        },
      ],
    };
  } catch (error) {
    await endHostedSession(session.taskId);
    throw new DeviceOperationNotAttempted(error);
  }
}
