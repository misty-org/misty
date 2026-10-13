import { Check, Hand, Play, Square } from "lucide-react";
import { formatShortcutLabel, detectShortcutPlatform } from "@/features/shortcuts";
import { IconButton } from "@/shared/ui";
import { AgentDockControls } from "./dock/AgentDockControls";
import { finishLocalExecution, type Execution } from "./localExecution";
import { autopilotStopShortcut } from "./workspaceAutopilot";

/** The island's button row: Take over or Resume, the dock controls, the autopilot hint, and Done or Stop. */
export function AgentControlTaskControls({
  execution,
  name,
  running,
  pending,
  stopped,
  act,
  takeOver,
  resume,
  stop,
}: {
  execution: Execution;
  name: string;
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
        <IconButton size="md" label="Take over" disabled={pending} onClick={takeOver}>
          <Hand className="size-4" />
        </IconButton>
      ) : (
        !finished && (
          <IconButton
            size="md"
            label={execution.state === "waiting" ? "Done" : "Resume"}
            disabled={pending || Boolean(execution.method && execution.state !== "waiting")}
            onClick={resume}
          >
            {execution.state === "waiting" ? (
              <Check className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
          </IconButton>
        )
      )}
      <AgentDockControls execution={execution} agentName={name} disabled={pending} act={act} />
      <span className="flex-1" />
      {execution.autopilot && running && !execution.desktopControl && (
        <kbd className="text-xs text-cream-muted">
          {formatShortcutLabel(autopilotStopShortcut(), detectShortcutPlatform())}
        </kbd>
      )}
      {finished || stopped ? (
        <IconButton
          size="md"
          label="Done"
          disabled={pending}
          onClick={() => act(finishLocalExecution)}
        >
          <Check className="size-4" />
        </IconButton>
      ) : (
        <IconButton size="md" label="Stop task" disabled={pending} onClick={stop}>
          <Square className="size-4" />
        </IconButton>
      )}
    </div>
  );
}
