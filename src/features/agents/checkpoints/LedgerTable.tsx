import { useState } from "react";
import { Button, Input } from "@/shared/ui";
import { setBrowserExpanded } from "../agentBrowser/agentBrowserStore";
import { StatusRow, StatusTable, type StatusState } from "../progress/StatusTable";
import { isOpen, type LedgerRow } from "./ledger";

const states: Record<LedgerRow["state"], StatusState> = {
  pending: "next",
  done: "done",
  failed: "failed",
  blocked: "waiting",
  skipped: "skipped",
};

function verb(row: LedgerRow) {
  if (row.needs === "input") return "Needs you";
  if (row.needs === "takeover") return "Needs you";
  if (row.state === "pending") return "Not done";
  return row.state === "blocked" ? "Blocked" : "Failed";
}

/**
 * How a run that did not finish ends when it kept a ledger (docs/plans/agent-checkpoints.md):
 * the parts still open, each with the action it needs, over a count of what is done. Resuming
 * works only the open parts; the finished ones are never done again.
 */
export function LedgerTable({
  rows,
  conversationId,
  working,
  onResume,
  onChange,
}: {
  rows: LedgerRow[];
  conversationId?: string;
  working: boolean;
  /** Carries on from these rows; `only` limits the work to some of the open ones. */
  onResume: (rows: LedgerRow[], only?: string[]) => void;
  onChange: (rows: LedgerRow[]) => void;
}) {
  const open = rows.filter(isOpen);
  const done = rows.filter((row) => row.state === "done").length;
  const [asking, setAsking] = useState<string>();
  const [hint, setHint] = useState("");
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const change = (id: string, patch: Partial<LedgerRow>) =>
    rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
  const send = (id: string) => {
    const next = hint.trim() ? change(id, { hint: hint.trim() }) : rows;
    setAsking(undefined);
    setHint("");
    onResume(next, [id]);
  };
  const retryAll = (
    <Button
      variant="primary"
      size="sm"
      disabled={working || !open.length}
      onClick={() => onResume(rows)}
    >
      Retry unfinished
    </Button>
  );
  return (
    <StatusTable
      label="Not finished"
      head={`${done} of ${rows.length} done${open.length ? ", the rest need a look" : ""}`}
      actions={open.length > 1 ? retryAll : undefined}
    >
      {open.map((row) => (
        <StatusRow
          key={row.id}
          state={states[row.state]}
          verb={verb(row)}
          sub={
            asking === row.id ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  send(row.id);
                }}
              >
                <Input
                  aria-label={`What Misty needs for “${row.requirement}”`}
                  autoFocus
                  value={hint}
                  placeholder="A link, a detail, or what to try"
                  onChange={(event) => setHint(event.target.value)}
                />
                <Button type="submit" size="sm" variant="primary" disabled={working}>
                  Send
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAsking(undefined)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              row.reason || undefined
            )
          }
          actions={
            asking === row.id ? undefined : (
              <>
                {row.needs === "takeover" || taken.has(row.id) ? (
                  taken.has(row.id) ? (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={working}
                      onClick={() => onResume(rows, [row.id])}
                    >
                      Continue
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (conversationId) setBrowserExpanded(conversationId, true);
                        setTaken(new Set(taken).add(row.id));
                      }}
                    >
                      Take over
                    </Button>
                  )
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={working}
                  onClick={() => onResume(rows, [row.id])}
                >
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={working}
                  onClick={() => setAsking(row.id)}
                >
                  Retry with a hint
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={working}
                  onClick={() =>
                    onChange(change(row.id, { state: "skipped", reason: "Skipped by you." }))
                  }
                >
                  Skip
                </Button>
              </>
            )
          }
        >
          {row.requirement}
        </StatusRow>
      ))}
    </StatusTable>
  );
}
