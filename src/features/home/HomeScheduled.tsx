import { describeNextRun, useWorkflowSchedulesStore } from "@/features/agents";
import { CalendarClock } from "lucide-react";
import { HomeLink } from "./HomeLink";

/** The next few scheduled workflow runs, under Today. */
export function HomeScheduled() {
  const runs = useWorkflowSchedulesStore((state) => state.runs);
  const upcoming = runs.filter((run) => run.enabled || run.state === "failed").slice(0, 3);
  return (
    <div className="mt-2 border-t border-charcoal-border pt-2">
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-1">
        <h3 className="text-xs font-medium text-cream-muted">
          <HomeLink
            to="/agents?view=workflows"
            className="flex items-center gap-2 rounded-md hover:text-cream-bright"
          >
            <CalendarClock size={14} aria-hidden="true" />
            Scheduled
          </HomeLink>
        </h3>
        <HomeLink
          to="/agents?view=workflows"
          className="rounded-md px-1.5 py-0.5 text-xs text-cream-muted hover:text-cream-bright"
        >
          {upcoming.length ? "See all" : "Schedule a workflow"}
        </HomeLink>
      </div>
      {upcoming.length ? (
        <ul className="grid gap-0.5">
          {upcoming.map((run) => (
            <li key={run.id}>
              <HomeLink
                to="/agents?view=workflows"
                className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-charcoal-active/45"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-cream-bright">
                  {run.title}
                </span>
                <span
                  className={
                    run.state === "failed"
                      ? "shrink-0 text-xs text-destructive"
                      : "shrink-0 text-xs tabular-nums text-cream-muted"
                  }
                >
                  {run.state === "failed" ? "Needs a look" : describeNextRun(run)}
                </span>
              </HomeLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 pb-2 text-xs text-cream-muted">
          Have Misty run a workflow for you on a schedule.
        </p>
      )}
    </div>
  );
}
