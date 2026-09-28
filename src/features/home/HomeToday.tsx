import { Button, cn } from "@/shared/ui";
import { CalendarDays, ListTodo } from "lucide-react";
import type { ReactNode } from "react";
import { formatAgendaTime } from "./homeFormat";
import { HomeLink } from "./HomeLink";
import type { HomeAgendaEntry } from "./useHomeAgenda";

/** Today's agenda across every Space, in time order, beside the Continue card. */
export function HomeToday(props: {
  state: "loading" | "ready" | "error";
  entries: HomeAgendaEntry[];
  onRetry: () => void;
  /** Upcoming scheduled runs render beneath the agenda once they exist. */
  footer?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="home-today-title"
      className="flex min-h-64 min-w-0 flex-col rounded-2xl lg:min-h-0 border border-charcoal-border bg-charcoal-card/55 p-2"
    >
      <h2
        id="home-today-title"
        className="flex items-center gap-2 px-3 pb-2 pt-2 text-xs font-medium text-cream-muted"
      >
        <ListTodo size={14} aria-hidden="true" />
        Today
      </h2>
      <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto">
        <TodayRows {...props} />
      </div>
      {props.footer}
    </section>
  );
}

function TodayRows(props: {
  state: "loading" | "ready" | "error";
  entries: HomeAgendaEntry[];
  onRetry: () => void;
}) {
  if (props.state === "loading") {
    return (
      <div className="grid gap-1.5 px-1" role="status" aria-label="Loading today’s agenda">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-12 animate-pulse rounded-xl bg-charcoal-active/45" />
        ))}
      </div>
    );
  }
  if (props.state === "error" && !props.entries.length) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <p className="text-sm text-cream-muted">Today’s agenda couldn’t load.</p>
        <Button size="sm" variant="ghost" onClick={props.onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (!props.entries.length) {
    return (
      <div className="flex items-center gap-3 px-3 py-3">
        <CalendarDays size={18} className="shrink-0 text-cream-muted" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-cream">Your day is clear.</p>
          <p className="mt-0.5 text-xs text-cream-muted">Nothing is due in your Spaces today.</p>
        </div>
      </div>
    );
  }
  return (
    <ul className="grid gap-0.5">
      {props.entries.map((entry) => (
        <li key={`${entry.spaceId}:${entry.kind}:${entry.id}`}>
          <HomeLink
            to={`/spaces/${encodeURIComponent(entry.spaceId)}/planner/agenda/day`}
            className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-charcoal-active/45"
          >
            <span className="w-14 shrink-0 text-xs tabular-nums text-cream-muted">
              {formatAgendaTime(entry.starts_at, entry.all_day)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-cream-bright">
                {entry.title}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs capitalize text-cream-muted">
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", agendaDotClass(entry.kind))}
                />
                {entry.spaceName} · {entry.kind.replace("_", " ")}
              </span>
            </span>
          </HomeLink>
        </li>
      ))}
    </ul>
  );
}

function agendaDotClass(kind: HomeAgendaEntry["kind"]): string {
  if (kind === "event") return "bg-avatar-blue";
  if (kind === "task") return "bg-avatar-green";
  if (kind === "goal") return "bg-agent-violet";
  if (kind === "milestone") return "bg-avatar-orange";
  return "bg-agent-indigo";
}
