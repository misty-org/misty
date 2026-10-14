import { useEffect } from "react";
import { shortcutMatchesEvent } from "@/features/shortcuts";
import { pauseLocalExecution, type Execution } from "./localExecution";
import { autopilotStopShortcut, watchWorkspaceAutopilot } from "./workspaceAutopilot";

/** A task that operates Misty itself holds the window only while it is current. */
export function useAgentControlAutopilot(
  execution: Execution | null | undefined,
  running: boolean,
  setError: (message: string) => void,
) {
  const taskId = execution?.taskId;
  useEffect(() => {
    if (!execution?.autopilot || !running || !execution.ready) return;
    const stop = (reason?: string) => {
      if (reason) setError(reason);
      void pauseLocalExecution(execution.taskId).catch((failure) => setError(String(failure)));
    };
    const unwatch = watchWorkspaceAutopilot(
      execution.taskId,
      execution.accountId,
      execution.spaceId,
      stop,
      execution.desktopControl,
    );
    const key = (event: KeyboardEvent) => {
      if (shortcutMatchesEvent(autopilotStopShortcut(), event)) {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      unwatch();
      window.removeEventListener("keydown", key, true);
    };
    // Re-watch only when the task, its readiness or its kind changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    taskId,
    execution?.accountId,
    execution?.spaceId,
    execution?.ready,
    execution?.desktopControl,
    running,
  ]);
}
