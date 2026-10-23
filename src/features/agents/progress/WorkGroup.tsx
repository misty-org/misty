import { Pressable } from "@/shared/ui";
import { useId, useState, type ReactNode } from "react";

/** Height animates open and closed; closed content leaves the tab order. */
export function Fold({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  return (
    <div id={id} className="agent-progress-fold" data-open={open || undefined} inert={!open}>
      <div>{children}</div>
    </div>
  );
}

export function Chevron() {
  return <span aria-hidden="true" className="agent-progress-chevron" />;
}

/**
 * One muted line with a chevron that opens to what is under it. It shimmers
 * while its work runs (only the outermost line does: `shimmer` turns it off for nested ones); unless the person chose, it is open while running (or
 * from the start with `openAtStart`) and folds once it finishes.
 */
export function WorkGroup({
  summary,
  running,
  openAtStart,
  autoOpen = true,
  shimmer = running,
  children,
}: {
  summary: ReactNode;
  running: boolean;
  openAtStart?: boolean;
  /** Opens by itself while running; false keeps it folded until the person opens it. */
  autoOpen?: boolean;
  /** Whether the line shimmers; defaults to running. */
  shimmer?: boolean;
  children: ReactNode;
}) {
  const [chosen, setChosen] = useState<boolean>();
  const open = chosen ?? (openAtStart || (autoOpen && running));
  const listId = useId();
  return (
    <div className="agent-progress-group" data-open={open || undefined}>
      <Pressable
        className="agent-progress-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setChosen(!open)}
      >
        <span className={shimmer ? "agent-progress-shimmer" : undefined} aria-live="polite">
          {summary}
        </span>
        <Chevron />
      </Pressable>
      <Fold id={listId} open={open}>
        {children}
      </Fold>
    </div>
  );
}
