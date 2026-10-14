import { Maximize2, SquareArrowDownLeft } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui";
import { attachTask, showDockedTask, useAgentDock } from "./agentDock";

/** Whether this tab's page is away in an agent's docked window. */
export function useTabAway(runtimeId: string) {
  return useAgentDock((state) => state.host?.tab === runtimeId);
}

/** Shown in a tab's place while an agent works on it in its own window. */
export function AgentTabAway() {
  const [error, setError] = useState("");
  const run = (action: () => Promise<void>) => {
    setError("");
    void action().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };
  return (
    <div className="grid h-full w-full place-items-center bg-charcoal-bg p-6 text-cream">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-sm">This tab is in the agent’s own window while it works.</p>
        <p className="text-xs text-cream-muted">
          It comes back here when the task ends. You can watch it in the corner, or bring it back
          now.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => run(showDockedTask)}>
            <Maximize2 className="size-4" aria-hidden="true" />
            Show
          </Button>
          <Button variant="outline" size="sm" onClick={() => run(attachTask)}>
            <SquareArrowDownLeft className="size-4" aria-hidden="true" />
            Bring back
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-cream-muted">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
