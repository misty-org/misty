import { TurnStatus } from "@misty/ui";
import { useNow } from "@/shared/hooks/use_now";
import { tookText } from "../meta/format";
import { RollingStat } from "./RollingStat";

export function LiveStatus({
  phrase,
  startedAt,
  tokens = 0,
  waiting = false,
}: {
  phrase: string;
  startedAt?: string;
  tokens?: number;
  waiting?: boolean;
}) {
  const now = useNow("second");
  const started = Date.parse(startedAt ?? "");
  const elapsed = Number.isFinite(started) ? Math.max(0, now - started) : 0;
  return (
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
    />
  );
}
