import { Check, Hand, Play, Square } from "lucide-react";
import { formatShortcutLabel, detectShortcutPlatform } from "@/features/shortcuts";
import { Button } from "@/shared/ui";
import { finishLocalExecution, type Execution } from "./localExecution";
import { autopilotStopShortcut } from "./workspaceAutopilot";

/** The island's button row: Take over or Resume, the autopilot hint, and Done or Stop. */
export function AgentControlTaskControls({
  execution,
  running,
  pending,
  stopped,
  act,
  takeOver,
  resume,
  stop,
}: {
  execution: Execution;
  running: boolean;
  pending: boolean;
  stopped: boolean;
  act: (action: () => Promise<unknown>) => void;
  takeOver: () => void;
  resume: () => void;
  stop: () => void;
}) {
  const finished = execution.state === "finished";
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Task controls">
      {running ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={takeOver}>
          <Hand className="size-3.5" aria-hidden="true" /> Take over
        </Button>
      ) : (
        !finished && (
          <Button
            size="sm"
            variant="primary"
            disabled={pending || Boolean(execution.method && execution.state !== "waiting")}
            onClick={resume}
          >
            {execution.state === "waiting" ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Play className="size-3.5" aria-hidden="true" />
            )}{" "}
            {execution.state === "waiting" ? "Done" : "Resume"}
          </Button>
        )
      )}
      <span className="flex-1" />
      {execution.autopilot && running && !execution.desktopControl && (
        <kbd className="text-xs text-cream-muted">
          {formatShortcutLabel(autopilotStopShortcut(), detectShortcutPlatform())}
        </kbd>
      )}
      {finished || stopped ? (
        <Button
          size="sm"
          variant="primary"
          disabled={pending}
          onClick={() => act(finishLocalExecution)}
        >
          <Check className="size-3.5" aria-hidden="true" /> Done
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={pending} onClick={stop}>
          <Square className="size-3.5" aria-hidden="true" /> Stop
        </Button>
      )}
    </div>
  );
}
