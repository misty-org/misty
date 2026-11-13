import { useEffect, useRef } from "react";
import { Skeleton, Text } from "@/shared/ui";
import {
  agentActivityApi,
  doingLabel,
  useMemberAgents,
  type AgentActivityLine,
} from "../list/memberAgents";
import { useSpaceResource } from "../api/spaceResource";
import { useSpaceItemCreator } from "../overview/useSpaceItemCreator";
import { OverviewCard } from "./OverviewCard";
import { useNow } from "@/shared/hooks/useNow";

const shown = 12;

const noLines: AgentActivityLine[] = [];

const timeOf = (value: string, now: number) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(now).toDateString() === date.toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const what = (line: AgentActivityLine) =>
  line.state === "resting" ? "Finished" : doingLabel(line.doing, line.state);

/**
 * A shared Space's activity log: what each member's agents started, finished and stopped to ask,
 * newest first. It shows the kind of work only, never what an agent wrote.
 */
export function SpaceActivityLog({ spaceId }: { spaceId: string }) {
  const now = useNow();
  // The last log paints at once on a revisit or relaunch, and a fresh one loads behind it.
  const log = useSpaceResource(`/spaces/${encodeURIComponent(spaceId)}/agent-activity`, () =>
    agentActivityApi.list(spaceId).then((result) => result.activity),
  );
  const lines = log.data ?? (log.error ? noLines : null);
  const who = useSpaceItemCreator(spaceId);
  const heard = useMemberAgents((state) => state.bySpace[spaceId]);
  const { reload } = log;
  const lastHeard = useRef(heard);
  useEffect(() => {
    if (heard === lastHeard.current) return;
    lastHeard.current = heard;
    // A change someone reported is in the log a moment later.
    const timer = window.setTimeout(() => void reload(), 900);
    return () => window.clearTimeout(timer);
  }, [heard, reload]);
  if (lines && !lines.length) return null;
  return (
    <OverviewCard title="Activity">
      {!lines ? (
        <ActivityRowsSkeleton rows={3} />
      ) : (
        <ul className="m-0 grid list-none p-0">
          {lines.slice(0, shown).map((line) => (
            <li key={line.id} className="flex min-h-9 min-w-0 items-center gap-2 px-2.5 text-sm">
              <Text full tone="default">
                {who(line.user_id, line.agent_id, line.name)}
              </Text>
              <Text bare tone="muted" className="shrink-0">
                {what(line)}
              </Text>
              <Text bare tone="muted" className="ml-auto shrink-0 text-xs tabular-nums">
                {timeOf(line.created_at, now)}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}

/**
 * Activity rows while the log first loads, shaped like them: who, what, then the time at the
 * row's end, on the same 36px rows.
 */
export function ActivityRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex min-h-9 items-center gap-2 px-2.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="ml-auto h-3 w-10" />
        </div>
      ))}
    </div>
  );
}
