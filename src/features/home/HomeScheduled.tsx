import { describeNextRun, useScheduledTasksStore } from "@/features/scheduled";
import { CalendarClock } from "lucide-react";
import { HomeLink } from "./HomeLink";

/** The next few scheduled runs, under Today. */
export function HomeScheduled() {
  const tasks = useScheduledTasksStore((state) => state.tasks);
  const upcoming = tasks.filter((task) => task.enabled || task.state === "failed").slice(0, 3);
  return (
    <div className="mt-2 border-t border-charcoal-border pt-2">
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-1">
        <h3 className="text-xs font-medium text-cream-muted">
          <HomeLink
            to="/scheduled"
            className="flex items-center gap-2 rounded-md hover:text-cream-bright"
          >
            <CalendarClock size={14} aria-hidden="true" />
            Scheduled
          </HomeLink>
        </h3>
        <HomeLink
          to="/scheduled"
          className="rounded-md px-1.5 py-0.5 text-xs text-cream-muted hover:text-cream-bright"
        >
          {upcoming.length ? "See all" : "Schedule a task"}
        </HomeLink>
      </div>
      {upcoming.length ? (
        <ul className="grid gap-0.5">
          {upcoming.map((task) => (
            <li key={task.id}>
              <HomeLink
                to={`/scheduled?task=${encodeURIComponent(task.id)}`}
                className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-charcoal-active/45"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-cream-bright">
                  {task.title}
                </span>
                <span
                  className={
                    task.state === "failed"
                      ? "shrink-0 text-xs text-destructive"
                      : "shrink-0 text-xs tabular-nums text-cream-muted"
                  }
                >
                  {task.state === "failed" ? "Needs a look" : describeNextRun(task)}
                </span>
              </HomeLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 pb-2 text-xs text-cream-muted">
          Have Misty do something for you on a schedule.
        </p>
      )}
    </div>
  );
}
