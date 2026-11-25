import { invoke } from "@tauri-apps/api/core";
import { webTabOfScope } from "@/features/browser";
import { watchAllRunEvents } from "../local-run/local_run_events";
import { agentAccountId } from "../../personal/agent_account";
import { holdAwake, releaseAwake } from "../jobs/keep_awake";
import { ensureAgentDevice } from "../../personal/use_agent_device_store";
import { agentsDeviceSnapshot } from "../../personal/use_agents_store";
import {
  DeviceOperationNotAttempted,
  type ClaimedWorkflowNodeJob,
} from "../jobs/worker_browser_jobs";
import {
  agentPageBounds,
  agentTab,
  closeAgentTab,
  sleepTaskTabs,
  trackAgentTab,
} from "../../tabs/agent_tabs";
import {
  maxOwnTabs,
  openSessionTab,
  signedSessionTab,
  startUrl,
  tabShowing,
} from "./hosted_session_tabs";
import {
  hostedSessionForTask,
  removeHostedChildTab,
  sessions,
  touchHostedSession,
  update,
  type HostedSession,
} from "./hosted_sessions_state";

const idleMs = 10 * 60_000;
const renewMs = 10_000;
const timers = new Map<string, ReturnType<typeof setInterval>>();
let unsubscribe: (() => void) | undefined;

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
  await sleepTaskTabs(taskId);
  await invoke("agent_workspace_release", { taskId }).catch(() => undefined);
  void releaseAwake(`hosted:${taskId}`);
  if (!sessions().length) {
    unsubscribe?.();
    unsubscribe = undefined;
  }
}

export async function endAllHostedSessions(): Promise<void> {
  await Promise.allSettled(sessions().map((session) => endHostedSession(session.taskId)));
}

function watchRequests(_accountId: string) {
  if (unsubscribe) return;
  unsubscribe = watchAllRunEvents((runId, event) => {
    if (!["invocation.completed", "invocation.failed", "invocation.canceled"].includes(event.type))
      return;
    for (const session of sessions())
      if (session.runId === runId) void endHostedSession(session.taskId);
  });
}

function keepAlive(session: HostedSession) {
  clearInterval(timers.get(session.taskId));
  let lastTick = Date.now();
  timers.set(
    session.taskId,
    setInterval(() => {
      const current = hostedSessionForTask(session.taskId);
      if (!current) return;
      const now = Date.now();
      const missed = now - lastTick > 3 * renewMs;
      lastTick = now;
      if (missed) touchHostedSession(current.scopeId, current.runId);
      const lastUsed = missed ? now : current.lastUsed;
      if (now - lastUsed > idleMs || agentAccountId() !== current.accountId) {
        void endHostedSession(current.taskId);
        return;
      }
      void invoke("agent_workspace_acquire", { request: { ...lease(current), renew: true } }).catch(
        () => void endHostedSession(current.taskId),
      );
    }, renewMs),
  );
}

export async function startHostedSession(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const config = (job.config ?? {}) as { agentId?: unknown };
  const input = (job.input ?? {}) as {
    url?: unknown;
    conversationId?: unknown;
    scopeId?: unknown;
    newTab?: unknown;
    closeScope?: unknown;
    appCommand?: unknown;
    useScope?: unknown;
  };
  if (input.appCommand) throw new DeviceOperationNotAttempted(new Error("app_window_unavailable"));
  const agentId = typeof config.agentId === "string" ? config.agentId : "";
  const conversationId = typeof input.conversationId === "string" ? input.conversationId : "";
  const accountId = agentAccountId();
  if (!agentId || !accountId || input.scopeId !== job.scopeId)
    throw new DeviceOperationNotAttempted(new Error("invalid_browser_grant"));
  const snapshot = await agentsDeviceSnapshot();
  if (!snapshot.device || snapshot.device.status === "revoked")
    throw new DeviceOperationNotAttempted(new Error("device_unavailable"));
  const device = await ensureAgentDevice(snapshot.device);
  if (job.scopeId !== `workspace:${device.id}`)
    throw new DeviceOperationNotAttempted(new Error("invalid_browser_grant"));

  let session = sessions().find(
    (item) => item.conversationId === conversationId && conversationId && item.agentId === agentId,
  );
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
          agentRunId: job.runId,
          ...agentPageBounds(),
        },
      });
      await invoke("agent_workspace_bind_scope", { taskId, scopeId });
      await invoke("browser_webview_hide", { request: { id: viewId, keepLive: true } });
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
  if (typeof input.useScope === "string") {
    const person = webTabOfScope(input.useScope);
    if (!person?.viewId) throw new DeviceOperationNotAttempted(new Error("unknown_tab"));
    try {
      await invoke("agent_workspace_bind_scope", {
        taskId: session.taskId,
        scopeId: input.useScope,
      });
      return await signedSessionTab(job, input.useScope, session.taskId);
    } catch (error) {
      throw new DeviceOperationNotAttempted(error);
    }
  }
  let tabScope = session.scopeId;
  if (input.newTab === true && typeof input.url === "string") {
    const url = startUrl(input.url);
    tabScope =
      (input.url ? tabShowing(session.taskId, url) : undefined) ??
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
