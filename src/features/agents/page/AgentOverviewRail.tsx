import { useEffect, useState, type ReactNode } from "react";

/**
 * The task panel beside the conversation. It stays mounted after its first
 * opening so it can slide out as well as in.
 */
export function AgentOverviewRail({
  id,
  open,
  children,
}: {
  id: string;
  open: boolean;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return (
    <aside
      id={id}
      className="agent-overview-rail"
      aria-label="Task panel"
      data-open={open}
      aria-hidden={!open}
      inert={!open}
    >
      {mounted && (
        <div className="agent-overview-rail-content misty-transient-scrollbar">{children}</div>
      )}
    </aside>
  );
}
