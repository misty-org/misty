import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { useUserStore } from "@/features/auth/core";
import { browserHomeUrl } from "@/features/workspace/browserHome";
import { visibleAutopilotAvailable } from "./betaModes";
import { browserTabAgentFileCapabilities } from "./browserTabCapabilities";
import { lease, releaseLease, remoteLease } from "./executionLease";
import {
  executionGeneration,
  finishLocalExecution,
  nextExecutionGeneration,
  pauseLocalExecution,
  replaceExecutionHeartbeat,
  settleLocalExecution,
  useLocalExecution,
  type Execution,
} from "./localExecutionState";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";

export interface LocalExecutionOptions {
  normalTabs: boolean;
  openWhenMissing?: boolean;
  /** The page a newly opened tab starts on. */
  url?: string;
  /** What the agent said the tab is for, to find the user's matching tab. */
  hint?: string;
  /** Exactly this tab: a follow-up continues where the earlier run worked. */
  tabId?: string;
  /** new: always a fresh tab; current: the tab in front of the user. */
  place?: "current" | "new";
  desktopControl?: boolean;
  method?: Execution["method"];
}

export async function startLocalExecution(
  accountId: string,
  agentId: string,
  options?: LocalExecutionOptions,
) {
  const spaceId = "";
  if (!hasTauriInternals() || !/Mac|Win/.test(navigator.platform))
    throw new Error("Agent execution requires Misty on macOS or Windows.");
  const accountGeneration = readApiSessionGeneration();
  const assertAccount = () => {
    if (
      isApiSessionTransitioning() ||
      readApiSessionGeneration() !== accountGeneration ||
      useUserStore.getState().me?.id !== accountId
    )
      throw new Error("The active account changed.");
  };
  assertAccount();
  let previous = useLocalExecution.getState().execution;
  // A new request replaces whatever the waiting run asked the user for.
  if (previous?.state === "waiting") {
    await pauseLocalExecution(previous.taskId);
    previous = useLocalExecution.getState().execution;
  }
  const sameScope = (run: Execution) =>
    run.agentId === agentId &&
    run.spaceId === spaceId &&
    run.normalTabs === options?.normalTabs &&
    run.desktopControl === options?.desktopControl;
  if (previous?.state === "finished" && !sameScope(previous)) {
    await finishLocalExecution();
    previous = null;
  }
  if (previous && (previous.accountId !== accountId || !sameScope(previous)))
    throw new Error("Stop the current task before changing its agent or conversation scope.");
  if (previous?.state === "running")
    throw new Error("Pause the active task before starting another request.");
  const epoch = nextExecutionGeneration();
  const execution: Execution = {
    taskId: crypto.randomUUID(),
    accountId,
    agentId,
    spaceId,
    method: options?.method ? structuredClone(options.method) : undefined,
    normalTabs: options?.normalTabs,
    desktopControl: options?.desktopControl,
    autopilot:
      !options?.normalTabs &&
      visibleAutopilotAvailable() &&
      /^space-/.test(getCurrentWindow().label),
    state: "running",
    views: [...(previous?.ready ? previous.views : [])],
    childViews: [...(previous?.ready ? (previous.childViews ?? []) : [])],
    context: [...(previous?.ready ? previous.context : [])],
    deviceContexts: [...(previous?.ready ? previous.deviceContexts : [])],
  };
  const assertCurrent = () => {
    assertAccount();
    if (
      executionGeneration() !== epoch ||
      useLocalExecution.getState().execution?.taskId !== execution.taskId
    )
      throw new Error("Task paused before its next action.");
  };
  let createdView: string | undefined;
  useLocalExecution.setState({ execution: { ...execution } });
  try {
    if (previous) {
      await releaseLease(previous);
      // A paused startup has no complete view/context pairing to resume. Its
      // late callbacks are fenced by generation; dispose any already-created views.
      if (!previous.ready) {
        for (const id of previous.views) {
          assertCurrent();
          await invoke("browser_webview_close", { request: { id } });
        }
      }
    }
    assertCurrent();
    await remoteLease(execution);
    assertCurrent();
    await invoke("agent_workspace_acquire", { request: lease(execution) });
    assertCurrent();
    if (execution.autopilot) {
      if (!execution.desktopControl) await getCurrentWindow().setFocus();
      await (
        await import("./workspaceAutopilot")
      ).startWorkspaceAutopilot(execution.taskId, accountId, spaceId, execution.desktopControl);
    }
    assertCurrent();
    startHeartbeat(execution, assertCurrent);
    await (await import("./taskArtifacts")).trackTaskArtifacts(accountId);
    assertCurrent();
    if (options?.normalTabs) {
      const normal = await (
        await import("./companion/normalTabs")
      ).companionBrowserContext(
        assertCurrent,
        options.openWhenMissing,
        options.url,
        options.hint,
        options.tabId,
        options.place,
      );
      assertCurrent();
      execution.views = [];
      execution.context = normal.context;
      execution.deviceContexts = normal.deviceContexts;
      for (const ref of normal.deviceContexts) {
        await invoke("agent_workspace_bind_scope", {
          taskId: execution.taskId,
          scopeId: ref.opaqueRef,
        });
        assertCurrent();
      }
      execution.ready = true;
      useLocalExecution.setState({ execution: { ...execution } });
      return execution;
    }
    if (previous) await rebindPreviousViews(execution, previous, assertCurrent);
    // Agents use the same native default profile as BrowserWorkspace. Logical
    // encrypted profile ownership will be resolved by the native host, not an
    // installed-app/provider hash selected by the renderer.
    if (!execution.deviceContexts.length)
      await createWorkspaceView(execution, assertCurrent, (id) => (createdView = id));
    assertCurrent();
    if (execution.autopilot && !execution.desktopControl) await getCurrentWindow().setFocus();
    assertCurrent();
    execution.ready = true;
    useLocalExecution.setState({ execution: { ...execution } });
    return execution;
  } catch (error) {
    if (createdView) {
      await invoke("browser_webview_close", { request: { id: createdView } }).catch(
        () => undefined,
      );
      const index = execution.views.indexOf(createdView);
      if (index >= 0) {
        execution.views.splice(index, 1);
        execution.context.splice(index, 1);
        execution.deviceContexts.splice(index, 1);
      }
    }
    await releaseLease(execution);
    if (executionGeneration() === epoch) await settleLocalExecution("paused", execution.taskId);
    throw error;
  }
}

/** Renews the task's authority every ten seconds; a stalled renderer pauses the task. */
function startHeartbeat(execution: Execution, assertCurrent: () => void) {
  let lastTick = Date.now();
  replaceExecutionHeartbeat(
    setInterval(() => {
      const now = Date.now();
      if (now - lastTick > 25000) {
        void pauseLocalExecution(execution.taskId);
        return;
      }
      lastTick = now;
      void Promise.resolve()
        .then(() => {
          assertCurrent();
          return remoteLease(execution, true);
        })
        .then(() => {
          assertCurrent();
          return invoke("agent_workspace_acquire", {
            request: { ...lease(execution), renew: true },
          });
        })
        .catch(() => void pauseLocalExecution(execution.taskId));
    }, 10000),
  );
}

/** Keeps the earlier task's default-profile browser views and binds them to this task. */
async function rebindPreviousViews(
  execution: Execution,
  previous: Execution,
  assertCurrent: () => void,
) {
  const discarded = execution.deviceContexts.filter(
    (ref) =>
      ref.metadata?.app_id !== "browser" ||
      Boolean(ref.metadata?.provider_id) ||
      Boolean(ref.metadata?.profile_id),
  );
  for (const ref of discarded) {
    assertCurrent();
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
      previousTaskId: previous.state === "paused" ? previous.taskId : undefined,
    });
  }
}

/** Opens the task's own hidden browser view and attaches it as the task's screen. */
async function createWorkspaceView(
  execution: Execution,
  assertCurrent: () => void,
  created: (id: string) => void,
) {
  const snapshot = await agentsDeviceSnapshot();
  assertCurrent();
  if (!snapshot.device) throw new Error("This device is unavailable for agent execution.");
  const device = await ensureServerAgentDevice(snapshot.device);
  assertCurrent();
  const id = `agent-${crypto.randomUUID()}`;
  const scopeId = `agent-scope-${crypto.randomUUID()}`;
  await invoke("browser_webview_create", {
    request: {
      id,
      scopeId,
      // Desktop control uses this inert view only as the existing device
      // operation/grant carrier. It never navigates a hidden task browser.
      url: execution.desktopControl ? "about:blank" : browserHomeUrl(),
      originSpaceId: execution.spaceId,
      x: 0,
      y: 64,
      width: Math.max(200, window.innerWidth - 440),
      height: Math.max(300, window.innerHeight - 128),
      theme: "dark",
    },
  });
  // A native create can finish after cancellation/account switching. Close
  // that exact view before propagating the stale-start error.
  try {
    assertCurrent();
  } catch (error) {
    await invoke("browser_webview_close", { request: { id } });
    throw error;
  }
  created(id);
  execution.views.push(id);
  await invoke("agent_workspace_bind_scope", { taskId: execution.taskId, scopeId });
  assertCurrent();
  await invoke("browser_webview_hide", { request: { id } });
  assertCurrent();
  execution.context.push({
    kind: "browser-tab",
    id: "browser:workspace",
    title: execution.desktopControl ? "Desktop" : "Browser",
    source: "current",
    privacy: "device",
    spaceId: execution.spaceId,
    opaqueScopeId: scopeId,
    attached: true,
    metadata: { app_id: "browser" },
  });
  execution.deviceContexts.push({
    deviceId: device.id,
    kind: "browser_tab",
    opaqueRef: scopeId,
    displayName: execution.desktopControl ? "Desktop screen control" : "Browser workspace",
    // Desktop and Misty-window screens act through browser_act goals with
    // Misty's own cursor. Browser tabs are read as text and acted on by ref.
    capabilities: execution.autopilot
      ? ["browser.workspace.visual", "browser.act"]
      : browserTabAgentFileCapabilities,
    metadata: {
      ...(execution.autopilot ? { workspace_control: true } : {}),
      ...(execution.desktopControl ? { desktop_control: true } : {}),
      app_id: "browser",
      window_label: getCurrentWindow().label,
    },
  });
}
