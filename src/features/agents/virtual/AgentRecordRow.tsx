import { CalendarDays, CheckCheck, ChevronsUp, Flame } from "lucide-react";
import { Badge, Tooltip } from "@/shared/ui";
import { doingIcons, skillWords } from "./doingIcons";
import type { AgentRecord } from "./studioProgress";

/**
 * An agent's record in the studio, as a game shows a player's stats: its level from the tasks it
 * finished, how many, its best run of them without a failure, the days it got something done, and
 * what it is good at: the kinds of work its finished tasks were mostly. Nothing shows before it has
 * finished anything.
 */
export function AgentRecordRow({ record }: { record?: AgentRecord }) {
  if (!record?.done) return null;
  const next = record.toNext
    ? `${record.toNext.need - record.toNext.have} more to level ${record.level + 1}`
    : "Top level";
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Record">
      <Tooltip content={next}>
        <Badge variant="secondary">
          <ChevronsUp aria-hidden="true" />
          Level {record.level}
        </Badge>
      </Tooltip>
      <Badge variant="secondary">
        <CheckCheck aria-hidden="true" />
        {record.done} done
      </Badge>
      {record.bestStreak > 1 ? (
        <Badge variant="secondary">
          <Flame aria-hidden="true" />
          Best streak {record.bestStreak}
        </Badge>
      ) : null}
      {record.days > 1 ? (
        <Badge variant="secondary">
          <CalendarDays aria-hidden="true" />
          {record.days} days
        </Badge>
      ) : null}
      {record.skills.map(({ code, tasks }) => {
        const Icon = doingIcons[code];
        const words = skillWords[code];
        if (!Icon || !words) return null;
        return (
          <Tooltip key={code} content={`${tasks} tasks done`}>
            <Badge variant="secondary">
              <Icon aria-hidden="true" />
              {words}
            </Badge>
          </Tooltip>
        );
      })}
    </div>
  );
}
