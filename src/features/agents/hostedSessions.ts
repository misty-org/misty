import { cachedRequest } from "@/api/cache/cached-request";
import { invoke } from "@tauri-apps/api/core";
import { subscribeAccountEvents } from "@/api/account-events";
import { useUserStore } from "@/features/auth/core";
import { holdAwake, releaseAwake } from "./keepAwake";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import { DeviceOperationNotAttempted, type ClaimedWorkflowNodeJob } from "./workerBrowserJobs";
import {
  agentPageBounds,
  agentTab,
  closeAgentTab,
  sleepTaskTabs,
  trackAgentTab,
} from "./agentTabs";
import {
  maxOwnTabs,
  openSessionTab,
  signedSessionTab,
  startUrl,
  tabShowing,
} from "./hostedSessionTabs";
import {
  hostedSessionForTask,
  removeHostedChildTab,
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
  // Its tabs sleep as the run's proof (agentTabs.ts); their pages close, then the lease goes.
  await sleepTaskTabs(taskId);
  await invoke("agent_workspace_release", { taskId }).catch(() => undefined);
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

// A request that stopped or finished ends its session at once rather than after the idle limit:
// its tabs sleep, so nothing it opened keeps a page alive.
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
          if (state === "canceled" || state === "completed" || state === "failed")
            void endHostedSession(session.taskId);
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

/**
 * browser.session: opens (or reuses, for the same conversation) a browser
 * session here and returns its tab with a grant this device signed.
 */
export async function startHostedSession(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  // An agent's tabs live in the person's window (docs/design/agent-browser/BRIEF.md).
  const config = (job.config ?? {}) as { agentId?: unknown };
  const input = (job.input ?? {}) as {
    url?: unknown;
    conversationId?: unknown;
    scopeId?: unknown;
    newTab?: unknown;
    closeScope?: unknown;
    appCommand?: unknown;
  };
  // Misty's own pages never open in an agent's tabs.
  if (input.appCommand) throw new DeviceOperationNotAttempted(new Error("app_window_unavailable"));
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
  // screen_close: one of the session's other tabs, which the run no longer keeps open.
  if (typeof input.closeScope === "string") {
    const view = session && removeHostedChildTab(session.taskId, input.closeScope);
    if (!view || !agentTab(input.closeScope))
      throw new DeviceOperationNotAttempted(new Error("unknown_tab"));
    await closeAgentTab(input.closeScope);
    return { closed: true };
  }
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
          theme: "dark",
          agentRunId: job.runId,
          ...agentPageBounds(),
        },
      });
      await invoke("agent_workspace_bind_scope", { taskId, scopeId });
      // Parked out of sight rather than hidden: a hidden page stops rendering, and
      // embedded widgets (schedules, booking calendars) never draw for the agent to read.
      await invoke("browser_webview_hide", { request: { id: viewId, keepLive: true } });
      // The agent reads the page next: let it load first, or its first read is about:blank.
      await invoke("browser_webview_await_load", { request: { id: viewId } }).catch(() => false);
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
    trackAgentTab({
      scopeId,
      viewId,
      taskId,
      runId: job.runId,
      url: startUrl(input.url),
      conversationId,
    });
    keepAlive(session);
    watchRequests(accountId);
    void holdAwake(`hosted:${taskId}`);
  } else {
    touchHostedSession(session.scopeId, job.runId);
  }
  // Another tab of the agent's own beside the first, when the run asks to keep a page open.
  // A page one of its tabs already shows is that tab, not a second one.
  let tabScope = session.scopeId;
  if (input.newTab === true && typeof input.url === "string") {
    const url = startUrl(input.url);
    tabScope =
      tabShowing(session.taskId, url) ??
      (session.childViews.length < maxOwnTabs - 1
        ? await openSessionTab(session, url, signal)
        : session.scopeId);
  }
  try {
    return await signedSessionTab(job, tabScope, session.taskId);
  } catch (error) {
    await endHostedSession(session.taskId);
    throw new DeviceOperationNotAttempted(error);
  }
}
