import { cn, EmptyState, Pressable, Skeleton } from "@/shared/ui";
import { dayKey, monthDays, type CalendarEntry } from "./calendarDates";

type ViewProps = {
  anchor: Date;
  /** `undefined` while the month is loading. */
  entries: Map<string, CalendarEntry[]> | undefined;
  onOpen(entry: CalendarEntry): void;
  onNew(day: string): void;
};

const entryLabel = (entry: CalendarEntry) =>
  entry.kind === "task"
    ? `Due: ${entry.title}`
    : entry.kind === "connected"
      ? `${entry.title} (Google Calendar)`
      : entry.title;

const entryLocation = (entry: CalendarEntry) =>
  entry.kind === "event"
    ? entry.event.location
    : entry.kind === "connected"
      ? entry.connected.location || "Google Calendar"
      : "";

/** A month as six weeks of days, each with what is on it. */
export function CalendarMonth({ anchor, entries, onOpen, onNew }: ViewProps) {
  const days = monthDays(anchor);
  const today = dayKey(new Date());
  return (
    <div className="grid h-full min-h-0 min-w-[640px] grid-rows-[auto_minmax(0,1fr)]">
      <div className="grid grid-cols-7 border-b border-charcoal-border/60">
        {days.slice(0, 7).map((day) => (
          <div key={day.getDay()} className="px-2 py-1.5 text-center text-2xs text-cream-muted">
            {day.toLocaleDateString(undefined, { weekday: "short" })}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const key = dayKey(day);
          const items = entries?.get(key) ?? [];
          return (
            <section
              key={key}
              aria-label={day.toDateString()}
              className={cn(
                "flex min-h-0 flex-col gap-0.5 overflow-hidden p-1",
                "border-b border-r border-charcoal-border/60",
                "[&:nth-child(7n)]:border-r-0",
                day.getMonth() !== anchor.getMonth() && "bg-charcoal-card/50",
              )}
            >
              <Pressable
                type="button"
                aria-label={`New event on ${day.toDateString()}`}
                className="flex h-6 items-center justify-center"
                onClick={() => onNew(key)}
              >
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-xs text-cream-muted",
                    key === today && "bg-cream font-semibold text-charcoal-bg",
                  )}
                >
                  {day.getDate()}
                </span>
              </Pressable>
              {entries ? (
                <>
                  {items.slice(0, 3).map((entry) => (
                    <Pressable
                      key={`${entry.kind}:${entry.id}`}
                      type="button"
                      title={entryLabel(entry)}
                      className={cn(
                        "flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-2xs hover:bg-charcoal-hover",
                        entry.kind === "task"
                          ? "border border-dashed border-charcoal-border text-cream-muted"
                          : entry.kind === "connected"
                            ? "border border-charcoal-border text-cream"
                            : "bg-charcoal-card text-cream",
                      )}
                      onClick={() => onOpen(entry)}
                    >
                      {entry.time ? (
                        <span className="shrink-0 tabular-nums text-cream-muted">{entry.time}</span>
                      ) : null}
                      <span className="truncate">{entry.title}</span>
                    </Pressable>
                  ))}
                  {items.length > 3 ? (
                    <span className="px-1.5 text-2xs text-cream-muted">
                      {items.length - 3} more
                    </span>
                  ) : null}
                </>
              ) : day.getDay() % 3 === 1 ? (
                <Skeleton className="h-4 w-4/5" />
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** The month as a list: only the days that have something, in order. */
export function CalendarAgenda({ anchor, entries, onOpen, onNew }: ViewProps) {
  if (!entries)
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-3 p-6">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  const days = monthDays(anchor).filter(
    (day) => day.getMonth() === anchor.getMonth() && entries.has(dayKey(day)),
  );
  if (!days.length)
    return <EmptyState className="h-full" title="Nothing on the calendar this month" />;
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-2xl gap-5 p-6">
        {days.map((day) => (
          <section key={dayKey(day)} className="grid gap-1.5">
            <Pressable
              type="button"
              className="w-fit text-xs font-semibold text-cream"
              aria-label={`New event on ${day.toDateString()}`}
              onClick={() => onNew(dayKey(day))}
            >
              {day.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </Pressable>
            {entries.get(dayKey(day))!.map((entry) => (
              <Pressable
                key={`${entry.kind}:${entry.id}`}
                type="button"
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-charcoal-border/70",
                  "bg-charcoal-card px-3 py-2 text-left text-sm hover:bg-charcoal-hover",
                )}
                onClick={() => onOpen(entry)}
              >
                <span className="w-20 shrink-0 text-xs tabular-nums text-cream-muted">
                  {entry.kind === "task" ? "Due" : entry.time || "All day"}
                </span>
                <span className="min-w-0 flex-1 truncate text-cream">{entry.title}</span>
                {entryLocation(entry) ? (
                  <span className="max-w-40 truncate text-xs text-cream-muted">
                    {entryLocation(entry)}
                  </span>
                ) : null}
              </Pressable>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
