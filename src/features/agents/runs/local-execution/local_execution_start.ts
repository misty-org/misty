import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { visibleAutopilotAvailable } from "../../page/beta_modes";
import { agentAccountId } from "../../personal/agent_account";
import { lease, releaseLease } from "../jobs/execution_lease";
import {
  executionGeneration,
  finishLocalExecution,
  nextExecutionGeneration,
  pauseLocalExecution,
  replaceExecutionHeartbeat,
  settleLocalExecution,
  useLocalExecution,
  type Execution,
} from "./local_execution_state";
import { createWorkspaceView } from "./local_execution_view";
import { trackTaskArtifacts } from "../../artifacts/task_artifacts";

interface LocalExecutionOptions {
  desktopControl?: boolean;
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
      agentAccountId() !== accountId
    )
      throw new Error("The active account changed.");
  };
  assertAccount();
  let previous = useLocalExecution.getState().execution;
  if (previous?.state === "waiting") {
    await pauseLocalExecution(previous.taskId);
    previous = useLocalExecution.getState().execution;
  }
  const sameScope = (run: Execution) =>
    run.agentId === agentId &&
    run.spaceId === spaceId &&
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
    desktopControl: options?.desktopControl,
    autopilot: visibleAutopilotAvailable() && /^space-/.test(getCurrentWindow().label),
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
      if (!previous.ready) {
        for (const id of previous.views) {
          assertCurrent();
          await invoke("browser_webview_close", { request: { id } });
        }
      }
    }
    assertCurrent();
    await invoke("agent_workspace_acquire", { request: lease(execution) });
    assertCurrent();
    if (execution.autopilot) {
      if (!execution.desktopControl) await getCurrentWindow().setFocus();
      await (
        await import("../jobs/workspace_autopilot")
      ).startWorkspaceAutopilot(execution.taskId, accountId, spaceId, execution.desktopControl);
    }
    assertCurrent();
    startHeartbeat(execution, assertCurrent);
    await trackTaskArtifacts(accountId);
    assertCurrent();
    if (previous) await rebindPreviousViews(execution, previous, assertCurrent);
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
          return invoke("agent_workspace_acquire", {
            request: { ...lease(execution), renew: true },
          });
        })
        .catch(() => void pauseLocalExecution(execution.taskId));
    }, 10000),
  );
}

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
