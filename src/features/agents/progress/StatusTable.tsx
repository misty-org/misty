import { Check, Circle, CircleAlert, CircleMinus, CircleX, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import "./statusTable.css";

/**
 * Every list of steps in a conversation (checklist, sub-agents, plan, requests,
 * unfinished work) is this one bordered table: a status icon and word, the thing
 * itself, a short result and its buttons. Color marks only "waiting for you"
 * (amber), "failed" (red) and "done"; the word always says it too.
 */
export type StatusState =
  "done" | "running" | "next" | "failed" | "waiting" | "stopped" | "skipped" | "plain";

const icons = {
  done: Check,
  running: LoaderCircle,
  next: Circle,
  failed: CircleX,
  waiting: CircleAlert,
  stopped: CircleAlert,
  skipped: CircleMinus,
} as const;

export function StatusTable({
  label,
  head,
  actions,
  children,
}: {
  label: string;
  /** A muted line over the rows, such as "Not finished" over its reasons. */
  head?: ReactNode;
  /** Buttons under the rows. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="agent-status-table" aria-label={label}>
      {head ? <div className="agent-status-head">{head}</div> : null}
      <ol>{children}</ol>
      {actions ? <div className="agent-status-actions">{actions}</div> : null}
    </section>
  );
}

export function StatusRow({
  state,
  verb,
  sub,
  meta,
  actions,
  depth = 0,
  children,
}: {
  state: StatusState;
  /** The status word: "Done", "Working", "Waiting for you". */
  verb?: ReactNode;
  sub?: ReactNode;
  /** Short result on the right. */
  meta?: ReactNode;
  /** Small buttons on the right, such as Stop. */
  actions?: ReactNode;
  depth?: number;
  children: ReactNode;
}) {
  const Icon = state === "plain" ? undefined : icons[state];
  return (
    <li
      className="agent-status-row"
      data-state={state}
      style={depth ? { paddingLeft: 14 + depth * 18 } : undefined}
    >
      {Icon ? <Icon className="agent-status-icon" size={14} aria-hidden="true" /> : null}
      {verb ? <span className="agent-status-verb">{verb}</span> : null}
      <span className="agent-status-target">
        {children}
        {sub ? <small>{sub}</small> : null}
      </span>
      {meta ? <span className="agent-status-meta">{meta}</span> : null}
      {actions ? <span className="agent-status-row-actions">{actions}</span> : null}
    </li>
  );
}
