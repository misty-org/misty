import { cn, EmptyState, Pressable, Skeleton, Surface, Text, Tooltip } from "@/shared/ui";
import { dayKey, monthDays, type CalendarEntry } from "./calendarDates";
import { useNow } from "@/shared/hooks/useNow";

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
  // Today moves at midnight while the calendar stays open.
  const today = dayKey(new Date(useNow()));
  return (
    <div className="grid h-full min-h-0 min-w-160 grid-rows-[auto_minmax(0,1fr)]">
      <div className="grid grid-cols-7 border-b">
        {days.slice(0, 7).map((day) => (
          <Text
            bare
            as="div"
            tone="muted"
            key={day.getDay()}
            className="px-2 py-1.5 text-center text-2xs"
          >
            {day.toLocaleDateString(undefined, { weekday: "short" })}
          </Text>
        ))}
      </div>
      <div className="grid min-h-0 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const key = dayKey(day);
          const items = entries?.get(key) ?? [];
          return (
            <Surface
              as="section"
              tone={day.getMonth() !== anchor.getMonth() ? "card" : "none"}
              key={key}
              aria-label={day.toDateString()}
              className={cn(
                "flex min-h-0 flex-col gap-0.5 overflow-hidden p-1",
                "border-b border-r",
                "[&:nth-child(7n)]:border-r-0",
              )}
            >
              <Pressable
                type="button"
                aria-label={`New event on ${day.toDateString()}`}
                className="flex h-6 items-center justify-center"
                onClick={() => onNew(key)}
              >
                {key === today ? (
                  <Surface
                    as="span"
                    tone="inverse"
                    className="grid size-6 place-items-center rounded-full text-xs font-semibold"
                  >
                    {day.getDate()}
                  </Surface>
                ) : (
                  <Text
                    bare
                    tone="muted"
                    className="grid size-6 place-items-center rounded-full text-xs"
                  >
                    {day.getDate()}
                  </Text>
                )}
              </Pressable>
              {entries ? (
                <>
                  {items.slice(0, 3).map((entry) => (
                    <Surface
                      key={`${entry.kind}:${entry.id}`}
                      tone={entry.kind === "event" ? "card" : "none"}
                      className="flex min-w-0 rounded"
                    >
                      <Tooltip content={entryLabel(entry)}>
                        <Pressable
                          type="button"
                          wash="card"
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-0.5 text-left text-2xs",
                            entry.kind === "task" && "border border-dashed",
                            entry.kind === "connected" && "border",
                          )}
                          onClick={() => onOpen(entry)}
                        >
                          {entry.time ? (
                            <Text bare tone="muted" className="shrink-0 tabular-nums">
                              {entry.time}
                            </Text>
                          ) : null}
                          <Text tone={entry.kind === "task" ? "muted" : "default"}>
                            {entry.title}
                          </Text>
                        </Pressable>
                      </Tooltip>
                    </Surface>
                  ))}
                  {items.length > 3 ? (
                    <Text bare tone="muted" className="px-1.5 text-2xs">
                      {items.length - 3} more
                    </Text>
                  ) : null}
                </>
              ) : day.getDay() % 3 === 1 ? (
                <Skeleton className="h-4 w-4/5" />
              ) : null}
            </Surface>
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
      // Shaped like the days below: a day's heading over its 38px entry rows.
      <div className="mx-auto grid w-full max-w-2xl gap-5 p-6" aria-hidden="true">
        {[2, 1, 2].map((rows, section) => (
          <div key={section} className="grid gap-1.5">
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-40" />
            </div>
            {Array.from({ length: rows }, (_, row) => (
              <Surface
                key={row}
                tone="card"
                radius="lg"
                className="flex h-9.5 items-center gap-3 border px-3"
              >
                <Skeleton className="h-3 w-20 shrink-0" />
                <Skeleton className="h-3.5 max-w-60 flex-1" />
              </Surface>
            ))}
          </div>
        ))}
      </div>
    );
  const days = monthDays(anchor).filter(
    (day) => day.getMonth() === anchor.getMonth() && entries.has(dayKey(day)),
  );
  if (!days.length)
    return (
      <EmptyState
        title="Nothing on the calendar this month"
        line="Events you add this month show up here, day by day."
      />
    );
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-2xl gap-5 p-6">
        {days.map((day) => (
          <section key={dayKey(day)} className="grid gap-1.5">
            <Pressable
              type="button"
              className="w-fit text-xs font-semibold"
              aria-label={`New event on ${day.toDateString()}`}
              onClick={() => onNew(dayKey(day))}
            >
              <Text bare tone="default">
                {day.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </Text>
            </Pressable>
            {entries.get(dayKey(day))!.map((entry) => (
              <Surface key={`${entry.kind}:${entry.id}`} tone="card" radius="lg" className="flex">
                <Pressable
                  type="button"
                  wash="card"
                  className="flex flex-1 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm"
                  onClick={() => onOpen(entry)}
                >
                  <Text bare tone="muted" className="w-20 shrink-0 text-xs tabular-nums">
                    {entry.kind === "task" ? "Due" : entry.time || "All day"}
                  </Text>
                  <Text full tone="default" className="min-w-0 flex-1">
                    {entry.title}
                  </Text>
                  {entryLocation(entry) ? (
                    <Text full tone="muted" className="max-w-40 text-xs">
                      {entryLocation(entry)}
                    </Text>
                  ) : null}
                </Pressable>
              </Surface>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
