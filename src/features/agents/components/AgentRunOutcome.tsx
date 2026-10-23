import type { GlobalAiMessage } from "@/features/misty/types";
import { Button } from "@/shared/ui";
import { LedgerTable } from "../checkpoints/LedgerTable";
import type { LedgerRow } from "../checkpoints/ledger";
import { StatusRow, StatusTable } from "../progress/StatusTable";
import type { UnfinishedItem } from "../progress/unfinished";

/**
 * How a run that did not finish ends, in the transcript where it happened and
 * never as a popup over the composer: its unfinished requirements with their
 * reasons, a plain failure, or a stop.
 */
export function AgentRunOutcome({
  message,
  remaining,
  failure,
  retryPrompt,
  retryFrom,
  working,
  onRetry,
  ledger = [],
  conversationId,
  onResume,
  onLedgerChange,
}: {
  message: GlobalAiMessage;
  remaining: UnfinishedItem[];
  /** The failure's own words, when the run failed without an answer. */
  failure: string;
  retryPrompt?: string;
  retryFrom?: string;
  working: boolean;
  onRetry: (prompt: string, fromMessageId?: string) => void;
  /** The rows the run kept (src/features/agents/checkpoints/ledger.ts). */
  ledger?: LedgerRow[];
  conversationId?: string;
  onResume?: (rows: LedgerRow[], only?: string[]) => void;
  onLedgerChange?: (rows: LedgerRow[]) => void;
}) {
  if (ledger.length && onResume && onLedgerChange && message.state !== "canceled")
    return (
      <LedgerTable
        rows={ledger}
        conversationId={conversationId}
        working={working}
        onResume={onResume}
        onChange={onLedgerChange}
      />
    );
  const retry =
    retryPrompt && message.retryable !== false ? (
      <Button
        variant="primary"
        size="sm"
        disabled={working}
        onClick={() => onRetry(retryPrompt, retryFrom)}
      >
        Try again
      </Button>
    ) : undefined;
  if (remaining.length)
    return (
      <StatusTable label="Not finished" head="Not finished" actions={retry}>
        {remaining.map((item) => (
          <StatusRow key={item.requirement} state="failed" sub={item.reason || undefined}>
            {item.requirement}
          </StatusRow>
        ))}
      </StatusTable>
    );
  if (message.state === "canceled")
    return (
      <StatusTable label="Stopped">
        <StatusRow state="stopped" verb="Stopped" sub="Changes already made were not undone.">
          You stopped this task
        </StatusRow>
      </StatusTable>
    );
  return (
    <StatusTable label="Run didn't finish" actions={retry}>
      <StatusRow state="failed" verb="Failed" sub={failure || undefined}>
        This task didn’t finish
      </StatusRow>
    </StatusTable>
  );
}
