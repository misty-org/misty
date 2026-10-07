import { useState, type ReactNode } from "react";
import { PanelsTopLeft } from "lucide-react";
import { Button } from "@/shared/ui";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { showAgentWindow } from "../agentWindowHandoff";

/**
 * The control bar above the composer. Screens open on demand, so there is no
 * work-location choice; a task working in a separate window can be shown.
 */
export function AgentControlBar({ children }: { children?: ReactNode }) {
  const [windowNotice, setWindowNotice] = useState("");
  const separate = useMistyStore((s) => s.working && s.executionMode === "team");
  return (
    <div className="agent-control-bar" role="group" aria-label="Conversation controls">
      {separate && hasTauriInternals() && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setWindowNotice("");
            const state = useMistyStore.getState();
            if (!state.selectedAgentId) return;
            void showAgentWindow(state.accountId, state.selectedAgentId).catch((error: unknown) =>
              setWindowNotice(
                error instanceof Error && !error.message.includes("No agent window is open")
                  ? error.message
                  : "The window will be available once the task starts.",
              ),
            );
          }}
        >
          <PanelsTopLeft size={13} />
          Show agent window
        </Button>
      )}
      {children}
      {windowNotice && (
        <p role="status" className="text-xs text-cream-muted">
          {windowNotice}
        </p>
      )}
    </div>
  );
}
