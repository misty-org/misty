import { useEffect, useState } from "react";
import { Skeleton } from "@/shared/ui";
import {
  agentActivityApi,
  doingLabel,
  useMemberAgents,
  type AgentActivityLine,
} from "../list/memberAgents";
import { useSpaceItemCreator } from "../overview/useSpaceItemCreator";
import { OverviewCard } from "./OverviewCard";

const shown = 12;

const timeOf = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date().toDateString() === date.toDateString()
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
  const [lines, setLines] = useState<AgentActivityLine[] | null>(null);
  const who = useSpaceItemCreator(spaceId);
  const heard = useMemberAgents((state) => state.bySpace[spaceId]);
  useEffect(() => {
    let live = true;
    // A change someone reported is in the log a moment later.
    const timer = window.setTimeout(
      () =>
        void agentActivityApi
          .list(spaceId)
          .then((result) => live && setLines(result.activity))
          .catch(() => live && setLines((known) => known ?? [])),
      lines === null ? 0 : 900,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `lines` only picks the first delay
  }, [spaceId, heard]);
  if (lines && !lines.length) return null;
  return (
    <OverviewCard title="Activity">
      {!lines ? (
        <div className="grid gap-2 px-2.5 py-2" aria-hidden="true">
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ) : (
        <ul className="m-0 grid list-none p-0">
          {lines.slice(0, shown).map((line) => (
            <li key={line.id} className="flex min-h-9 min-w-0 items-center gap-2 px-2.5 text-sm">
              <span className="truncate text-cream">
                {who(line.user_id, line.agent_id, line.name)}
              </span>
              <span className="shrink-0 text-cream-muted">{what(line)}</span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-cream-muted">
                {timeOf(line.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}
