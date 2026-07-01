import { MessageSquare, Pause, Play, Square, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/shared/ui";
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  finishLocalExecution,
  pauseLocalExecution,
  steerLocalExecution,
  type Execution,
} from "./localExecution";
import { watchWorkspaceAutopilot } from "./workspaceAutopilot";

export const agentOverlayBarClass =
  "pointer-events-auto fixed bottom-4 left-1/2 z-[2147482600] flex w-max max-w-[calc(100dvw-32px)] -translate-x-1/2 items-center rounded-lg bg-charcoal-card p-1 text-cream shadow-lg";

export function WorkspaceAutopilotBar({ execution, name }: { execution: Execution; name: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const running = execution.state === "running";
  useEffect(() => {
    setError("");
    const failed = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: string; message: string }>).detail;
      if (detail.taskId === execution.taskId) setError(detail.message);
    };
    window.addEventListener("misty:autopilot-error", failed);
    return () => window.removeEventListener("misty:autopilot-error", failed);
  }, [execution.taskId]);

  useEffect(() => {
    const stop = (reason?: string) => {
      if (reason) setError(reason);
      void pauseLocalExecution(execution.taskId).catch((failure) => setError(String(failure)));
    };
    if (!running || !execution.ready) return;
    const unwatch = watchWorkspaceAutopilot(
      execution.taskId,
      execution.accountId,
      execution.spaceId,
      stop,
    );
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && event.metaKey && event.shiftKey) {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      unwatch();
      window.removeEventListener("keydown", key, true);
    };
  }, [execution.taskId, execution.accountId, execution.spaceId, execution.ready, running]);
  useEffect(() => {
    if (error) useMistyStore.setState({ error });
  }, [error]);
  const act = (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    setError("");
    void action()
      .catch((reason) => setError(String(reason)))
      .finally(() => setPending(false));
  };
  return (
    <aside
      aria-label="Agent control"
      className={agentOverlayBarClass}
      title={
        error ||
        (running
          ? `${name} is controlling Misty`
          : execution.state === "paused"
            ? "Paused"
            : "Task finished")
      }
    >
      <p className="sr-only" role="status">
        {error ||
          (running
            ? execution.ready
              ? `${name} is controlling Misty. You can watch or stop at any time.`
              : "Preparing Misty window control…"
            : execution.state === "finished"
              ? "Task finished — you have control."
              : "Paused — you have control.")}
      </p>
      <div className="flex items-center gap-1" role="group" aria-label="Playback controls">
        <Button
          variant="ghost"
          size="icon"
          title="Show chat"
          aria-label="Show chat"
          onClick={() => useMistyStore.getState().openPanel()}
        >
          <MessageSquare className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Resume"
          aria-label="Resume"
          disabled={pending || execution.state !== "paused"}
          onClick={() =>
            act(() =>
              steerLocalExecution(
                "Continue the task. Capture the whole Misty window first and verify prior actions before continuing.",
              ),
            )
          }
        >
          <Play className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Pause"
          aria-label="Pause"
          disabled={pending || !running}
          onClick={() => act(() => pauseLocalExecution(execution.taskId))}
        >
          <Pause className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={execution.state === "finished" ? "Done" : "Stop task"}
          aria-label={execution.state === "finished" ? "Done" : "Stop task"}
          disabled={pending}
          onClick={() => act(finishLocalExecution)}
        >
          {execution.state === "finished" ? (
            <Check className="size-4" />
          ) : (
            <Square className="size-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}
