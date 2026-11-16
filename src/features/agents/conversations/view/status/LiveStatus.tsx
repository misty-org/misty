import { StepDot, Text } from "@/shared/ui";
import { useNow } from "@/shared/hooks/useNow";
import { tookText } from "../meta/format";
import { RollingStat } from "./RollingStat";

/**
 * The live reply's last line in the transcript: what the run is doing now, how long it has been
 * going, and the tokens it has written so far, rolling as the engine reports usage. Plain text at
 * the steps' size, with no box; it goes away when the reply ends and its footer takes over.
 */
export function LiveStatus({
  phrase,
  startedAt,
  tokens = 0,
}: {
  phrase: string;
  /** When the run started, as an ISO date. */
  startedAt?: string;
  /** Output tokens so far. */
  tokens?: number;
}) {
  const now = useNow("second");
  const started = Date.parse(startedAt ?? "");
  const elapsed = Number.isFinite(started) ? Math.max(0, now - started) : 0;
  return (
    <Text
      bare
      as="div"
      size="meta"
      tone="muted"
      className="flex min-h-8 items-center gap-2 whitespace-nowrap tabular-nums"
      role="status"
      aria-live="polite"
    >
      <StepDot state="working" size="sm" />
      <span className="misty-shimmer min-w-0 truncate">{phrase}</span>
      {elapsed >= 1000 ? <span className="shrink-0">· {tookText(elapsed)}</span> : null}
      {tokens > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-1">
          ·
          <RollingStat value={tokens} />
          {tokens === 1 ? "token" : "tokens"}
        </span>
      ) : null}
    </Text>
  );
}
