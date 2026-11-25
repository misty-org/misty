import { useId, useState, type ReactNode } from "react";
import { ToolBody, ToolList, TurnStatus } from "@misty/ui";
import { useNow } from "@/shared/hooks/use_now";
import { Fold } from "../../../progress/WorkGroup";
import { tookText } from "../meta/format";
import { RollingStat } from "./RollingStat";

export function LiveStatus({
  phrase,
  startedAt,
  tokens = 0,
  waiting = false,
  output,
}: {
  phrase: string;
  startedAt?: string;
  tokens?: number;
  waiting?: boolean;
  output?: ReactNode;
}) {
  const now = useNow("second");
  const [open, setOpen] = useState(false);
  const outputId = useId();
  const started = Date.parse(startedAt ?? "");
  const elapsed = Number.isFinite(started) ? Math.max(0, now - started) : 0;
  return (
    <>
      <TurnStatus
        phrase={phrase}
        waiting={waiting}
        elapsed={elapsed >= 1000 ? tookText(elapsed) : undefined}
        extra={
          tokens > 0 ? (
            <span className="inline-flex items-center gap-1">
              <RollingStat value={tokens} />
              {tokens === 1 ? "token" : "tokens"}
            </span>
          ) : undefined
        }
        open={output ? open : undefined}
        onToggle={output ? () => setOpen(!open) : undefined}
        controls={output ? outputId : undefined}
      />
      {output ? (
        <Fold id={outputId} open={open} onReveal={() => setOpen(true)}>
          <ToolList label={phrase}>
            <li>
              <ToolBody>{output}</ToolBody>
            </li>
          </ToolList>
        </Fold>
      ) : null}
    </>
  );
}
