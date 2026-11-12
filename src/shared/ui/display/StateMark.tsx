import { Check, X } from "lucide-react";
import { cn } from "../classNames";
import { Spinner } from "../feedback/Spinner";
import { Tooltip } from "../overlays/Tooltip";

/** The states an item can show with a mark: an agent's run, or something new to read. */
export type StateMarkKind = "working" | "waiting" | "unread" | "done" | "failed";

export type StateMarkProps = {
  kind: StateMarkKind;
  /**
   * The mark's tooltip and accessible name, such as "Failed: the key was refused". Defaults to
   * the state's own words ("Working", "Waiting for you", "Unread", "Done", "Failed").
   */
  label?: string;
  /** Layout only: margins or placement. */
  className?: string;
};

const defaultLabel: Record<StateMarkKind, string> = {
  working: "Working",
  waiting: "Waiting for you",
  unread: "Unread",
  done: "Done",
  failed: "Failed",
};

/**
 * The one mark for an item's state, the same wherever it shows: a muted spinner while an agent
 * works, an amber dot while it waits on the person, a neutral dot for unread, a green check when
 * done and a red cross when it failed. Each names itself in Misty's tooltip. It sits in a 16px box,
 * so marks line up in a column of rows.
 *
 * `<StateMark kind="failed" label="Failed: out of credits" />`
 */
export function StateMark({ kind, label, className }: StateMarkProps) {
  const name = label || defaultLabel[kind];
  return (
    <Tooltip content={name}>
      <span
        role="img"
        aria-label={name}
        data-slot="state-mark"
        data-state={kind}
        className={cn("grid size-4 shrink-0 place-items-center", markTone[kind], className)}
      >
        {kind === "working" ? <Spinner size="sm" label={false} /> : null}
        {kind === "waiting" || kind === "unread" ? (
          <span aria-hidden="true" className={cn("size-2 rounded-full", dotTone[kind])} />
        ) : null}
        {kind === "done" ? <Check aria-hidden="true" className="size-4" /> : null}
        {kind === "failed" ? <X aria-hidden="true" className="size-4" /> : null}
      </span>
    </Tooltip>
  );
}

const markTone: Record<StateMarkKind, string> = {
  working: "text-cream-muted",
  waiting: "",
  unread: "",
  done: "text-state-done",
  failed: "text-state-failed",
};

const dotTone = { waiting: "bg-state-waiting", unread: "bg-cream" } as const;
