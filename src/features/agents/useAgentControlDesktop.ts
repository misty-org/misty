import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import type { Execution } from "./localExecution";

type IslandHandlers = {
  resume: () => void;
  takeOver: () => void;
  send: (text: string, queue: boolean) => void;
};

/** The native island during desktop control: mirror the status, take its presses. */
export function useAgentControlDesktop(
  execution: Execution | null | undefined,
  status: string,
  meta: string,
  questions: number,
  handlers: IslandHandlers,
) {
  const taskId = execution?.taskId;
  const desktop = Boolean(execution?.desktopControl);
  useEffect(() => {
    if (!desktop || !taskId) return;
    void invoke("agent_control_island", {
      taskId,
      island: {
        status,
        meta,
        waiting: execution?.state === "waiting" || questions ? status : "",
      },
    }).catch(() => {});
  }, [desktop, taskId, status, meta, execution?.state, questions]);
  useEffect(() => {
    if (!desktop || !taskId) return;
    const remove = getCurrentWindow().listen<{ taskId?: string; action?: string; text?: string }>(
      "misty://agent-island",
      ({ payload }) => {
        if (payload.taskId !== taskId) return;
        if (payload.action === "send" || payload.action === "queue")
          handlers.send(payload.text ?? "", payload.action === "queue");
        else if (payload.action === "takeover") handlers.takeOver();
        else if (payload.action === "done") handlers.resume();
      },
    );
    return () => void remove.then((unlisten) => unlisten());
    // The handlers read the current task through the store; re-listen per task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, taskId]);
}
