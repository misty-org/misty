import { Maximize2, Minimize2, PictureInPicture2, SquareArrowDownLeft } from "lucide-react";
import { IconButton } from "@/shared/ui";
import { isAgentWorkerWindow, type Execution } from "../localExecution";
import {
  attachTask,
  canDetach,
  detachTask,
  dockAvailable,
  dockThisWindow,
  showDockedTask,
  useAgentDock,
} from "./agentDock";

/**
 * The island's dock controls. In the person's window: Detach sends the task's
 * tab to its own docked window; Show and Bring back act on it while it is away.
 * In an agent's own window: Dock shrinks it back to its corner.
 */
export function AgentDockControls({
  execution,
  agentName,
  disabled,
  act,
}: {
  execution: Execution;
  agentName: string;
  disabled: boolean;
  act: (action: () => Promise<unknown>) => void;
}) {
  const host = useAgentDock((state) => state.host);
  const docked = useAgentDock((state) => state.docked);
  if (!dockAvailable()) return null;
  if (isAgentWorkerWindow())
    return docked ? null : (
      <IconButton
        size="md"
        label="Dock"
        disabled={disabled}
        onClick={() => act(() => dockThisWindow(agentName))}
      >
        <Minimize2 className="size-4" />
      </IconButton>
    );
  if (host)
    return (
      <>
        <IconButton
          size="md"
          label="Show agent window"
          disabled={disabled}
          onClick={() => act(showDockedTask)}
        >
          <Maximize2 className="size-4" />
        </IconButton>
        <IconButton
          size="md"
          label="Bring back to this window"
          disabled={disabled}
          onClick={() => act(attachTask)}
        >
          <SquareArrowDownLeft className="size-4" />
        </IconButton>
      </>
    );
  if (!canDetach(execution)) return null;
  return (
    <IconButton
      size="md"
      label="Detach"
      disabled={disabled}
      onClick={() => act(() => detachTask(execution, agentName))}
    >
      <PictureInPicture2 className="size-4" />
    </IconButton>
  );
}
