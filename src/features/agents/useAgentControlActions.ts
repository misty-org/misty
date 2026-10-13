import { useEffect, useState } from "react";
import { releasePendingWait } from "@/features/agent-interventions/WaitingForYouCard";
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  finishLocalExecution,
  pauseLocalExecution,
  queueLocalFollowup,
  routeLocalFollowup,
  steerLocalExecution,
  type Execution,
} from "./localExecution";

/** The island's notices and the controls that act on the current task, one at a time. */
export function useAgentControlActions(execution: Execution | null | undefined) {
  const taskId = execution?.taskId;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setError("");
    setNotice("");
    setStopped(false);
    const failed = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: string; message: string }>).detail;
      if (detail.taskId === taskId) setError(detail.message);
    };
    window.addEventListener("misty:autopilot-error", failed);
    return () => window.removeEventListener("misty:autopilot-error", failed);
  }, [taskId]);

  const act = (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    void action()
      .catch((reason) => setError(String(reason)))
      .finally(() => setPending(false));
  };
  const resume = () =>
    act(async () => {
      if (!execution) return;
      setStopped(false);
      // A run waiting for the person continues itself once released.
      if (
        execution.state === "waiting" &&
        (await releasePendingWait(execution.accountId, useMistyStore.getState().invocationId))
      )
        return;
      await steerLocalExecution(
        execution.desktopControl
          ? "Continue the task. Inspect the current desktop and verify prior actions before continuing."
          : execution.autopilot
            ? "Continue the task. Capture the whole Misty window first and verify prior actions before continuing."
            : "Continue the current task. Inspect the current state first; do not repeat completed or uncertain writes.",
      );
    });
  const takeOver = () => act(() => pauseLocalExecution(execution?.taskId));
  // Stop ends the task. A task with its own tabs pauses instead, so its result
  // stays open for review until Done closes it.
  const stop = () =>
    act(async () => {
      if (!execution) return;
      if (execution.views.length || execution.childViews?.length) {
        await pauseLocalExecution(execution.taskId);
        setStopped(true);
      } else await finishLocalExecution();
    });
  const send = (text: string, queue: boolean) =>
    act(async () => {
      const prompt = text.trim();
      if (!prompt) return;
      setMessage("");
      if (queue) {
        await queueLocalFollowup(prompt);
        setNotice("Queued after this task.");
      } else setNotice(await routeLocalFollowup(prompt));
    });

  return {
    error,
    setError,
    notice,
    pending,
    stopped,
    message,
    setMessage,
    act,
    resume,
    takeOver,
    stop,
    send,
  };
}
