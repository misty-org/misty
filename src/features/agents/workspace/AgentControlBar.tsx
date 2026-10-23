import type { ReactNode } from "react";

/**
 * The control bar above the composer. Screens open on demand, so there is no
 * work-location choice.
 */
export function AgentControlBar({ children }: { children?: ReactNode }) {
  return (
    <div className="agent-control-bar" role="group" aria-label="Conversation controls">
      {children}
    </div>
  );
}
