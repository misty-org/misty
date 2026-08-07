import { useEffect, useRef } from "react";
import { CalendarDays, CheckSquare2, GitFork } from "lucide-react";
import type { SpaceAgendaEntry } from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import { Button, cn } from "@/ui";
import { dayKey, groupAgendaEntries, startOfDay, startOfWeek } from "./agendaDates";

export type AgendaZoomMinutes = 60 | 30 | 15;

interface AgendaViewProps {
  anchor: Date;
  entries: SpaceAgendaEntry[];
  onOpen: (entry: SpaceAgendaEntry) => void;
}

interface AgendaTimelineViewProps extends AgendaViewProps {
  view: "week" | "day";
  zoomMinutes: AgendaZoomMinutes;
  onZoom: (direction: "in" | "out") => void;
}

export function AgendaMonthView({ anchor, entries, onOpen }: AgendaViewProps) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const grouped = groupAgendaEntries(entries);
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return day;
  });

  return (
    <div className="misty-transient-scrollbar h-full min-h-0 overflow-auto">
      <div className="grid min-h-full min-w-[760px] grid-rows-[auto_repeat(6,minmax(112px,1fr))] border-l border-t border-charcoal-border/60">
        <div className="grid grid-cols-7 border-b border-charcoal-border/60 bg-charcoal-bg">
          {days.slice(0, 7).map((day) => (
            <div
              className="border-r border-charcoal-border/60 px-3 py-2.5 text-center text-[11px] font-medium uppercase tracking-wide text-cream-muted"
              key={day.toISOString()}
            >
              {day.toLocaleDateString(undefined, { weekday: "short" })}
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, weekIndex) => (
          <div className="grid min-h-0 grid-cols-7" key={weekIndex}>
            {days.slice(weekIndex * 7, weekIndex * 7 + 7).map((day) => {
              const items = grouped[dayKey(day)] ?? [];
              const muted = day.getMonth() !== anchor.getMonth();
              const today = isSameDay(day, new Date());
              return (
                <section
                  className={cn(
                    "min-h-0 border-b border-r border-charcoal-border/60 px-1.5 py-1.5",
                    muted && "bg-charcoal-card text-cream-muted",
                  )}
                  key={day.toISOString()}
                  aria-label={day.toDateString()}
                >
                  <div className="mb-1 flex h-6 items-center justify-center">
                    <span
                      className={cn(
                        "grid size-6 place-items-center rounded-full text-xs",
                        today && "bg-cream font-semibold text-charcoal-bg",
                      )}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                  <div className="grid gap-0.5">
                    {items.slice(0, 4).map((entry) => (
                      <AgendaMonthChip entry={entry} key={entry.id} onOpen={onOpen} />
                    ))}
                    {items.length > 4 ? (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium text-cream-muted">
                        +{items.length - 4} more
                      </span>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgendaTimelineView({
  anchor,
  entries,
  onOpen,
  view,
  zoomMinutes,
  onZoom,
}: AgendaTimelineViewProps) {
  const start = view === "week" ? startOfWeek(anchor) : startOfDay(anchor);
  const dayCount = view === "week" ? 7 : 1;
  const days = Array.from({ length: dayCount }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return day;
  });
  const grouped = groupAgendaEntries(entries);
  const slotHeight = zoomMinutes === 60 ? 36 : zoomMinutes === 30 ? 22 : 18;
  const hourHeight = slotHeight * (60 / zoomMinutes);
  const timelineHeight = hourHeight * 24;
  const slots = Array.from({ length: (24 * 60) / zoomMinutes + 1 }, (_, index) => index);
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousScaleRef = useRef(hourHeight);
  const previousRangeRef = useRef(`${view}:${dayKey(start)}`);
  const initialScrollHour = days.some((day) => isSameDay(day, new Date()))
    ? Math.max(0, new Date().getHours() - 1)
    : 7;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const rangeKey = `${view}:${dayKey(start)}`;
    if (previousRangeRef.current !== rangeKey) {
      element.scrollTop = hourHeight * initialScrollHour;
      previousRangeRef.current = rangeKey;
    } else if (previousScaleRef.current !== hourHeight) {
      element.scrollTop = element.scrollTop * (hourHeight / previousScaleRef.current);
    } else if (element.scrollTop === 0) {
      element.scrollTop = hourHeight * initialScrollHour;
    }
    previousScaleRef.current = hourHeight;
  }, [hourHeight, initialScrollHour, start.getTime(), view]);

  const now = new Date();
  const showNow = days.some((day) => isSameDay(day, now));
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * hourHeight;
  const currentTimeLabel = formatTime(now.toISOString());
  const currentTimeMatchesHour = now.getMinutes() === 0;

  return (
    <div
      ref={scrollRef}
      className="misty-transient-scrollbar h-full min-h-0 overflow-auto [overscroll-behavior:contain]"
      aria-label={`${view} calendar timeline`}
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        onZoom(event.deltaY < 0 ? "in" : "out");
      }}
    >
      <div
        className="relative min-h-full border-l border-t border-charcoal-border/60"
        style={{ minWidth: view === "week" ? 920 : 640 }}
      >
        <div className="sticky top-0 z-30 bg-charcoal-bg ">
          <div
            className="grid min-h-14 border-b border-charcoal-border/60"
            style={{ gridTemplateColumns: `72px repeat(${dayCount}, minmax(0, 1fr))` }}
          >
            <div className="border-r border-charcoal-border/60" />
            {days.map((day) => (
              <div
                className="flex items-center justify-center gap-1.5 border-r border-charcoal-border/60 px-2 text-center"
                key={day.toISOString()}
              >
                <span className="text-xs font-medium text-cream-muted">
                  {day.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-[13px] text-cream",
                    isSameDay(day, now) && "bg-cream font-semibold text-charcoal-bg",
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
            ))}
          </div>
          <div
            className="grid min-h-[54px] border-b border-charcoal-border/60"
            style={{ gridTemplateColumns: `72px repeat(${dayCount}, minmax(0, 1fr))` }}
          >
            <div className="flex items-center justify-center border-r border-charcoal-border/60 text-xs text-cream-muted">
              All day
            </div>
            {days.map((day) => (
              <div
                className="flex min-w-0 flex-col justify-center gap-1 border-r border-charcoal-border/60 px-1.5 py-1"
                key={day.toISOString()}
              >
                {(grouped[dayKey(day)] ?? [])
                  .filter((entry) => entry.all_day)
                  .slice(0, 2)
                  .map((entry) => (
                    <AgendaAllDayChip entry={entry} key={entry.id} onOpen={onOpen} />
                  ))}
              </div>
            ))}
          </div>
        </div>

        <div
          className="relative grid"
          style={{
            height: timelineHeight,
            gridTemplateColumns: `72px repeat(${dayCount}, minmax(0, 1fr))`,
          }}
        >
          <div className="relative border-r border-charcoal-border/60" aria-hidden="true">
            {hours.map((hour) => {
              if (showNow && currentTimeMatchesHour && hour === now.getHours()) return null;
              return (
                <span
                  className="absolute right-3 text-[11px] text-cream-muted"
                  key={hour}
                  style={{ top: hour * hourHeight + 8 }}
                >
                  {formatHour(hour)}
                </span>
              );
            })}
          </div>
          {days.map((day) => {
            const timedEntries = (grouped[dayKey(day)] ?? []).filter((entry) => !entry.all_day);
            return (
              <div className="relative border-r border-charcoal-border/60" key={day.toISOString()}>
                {slots.map((slot) => {
                  const major = (slot * zoomMinutes) % 60 === 0;
                  return (
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-x-0 border-t",
                        major ? "border-charcoal-border/60" : "border-charcoal-border/30",
                      )}
                      key={slot}
                      style={{ top: slot * slotHeight }}
                    />
                  );
                })}
                {timedEntries.map((entry) => (
                  <AgendaTimedEvent
                    entry={entry}
                    hourHeight={hourHeight}
                    key={entry.id}
                    minimumMinutes={zoomMinutes}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            );
          })}
          {showNow ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-20"
              style={{ top: nowTop }}
              aria-label={`Current time ${currentTimeLabel}`}
            >
              <span className="absolute left-[72px] right-0 flex -translate-y-1/2 items-center">
                <span className="size-3 shrink-0 -translate-x-1/2 rounded-full bg-avatar-red" />
                <span className="-ml-1.5 h-px w-2 shrink-0 bg-avatar-red" />
                <span className="shrink-0 whitespace-nowrap rounded bg-charcoal-bg px-1.5 py-0.5 text-[10px] font-semibold text-avatar-red">
                  {currentTimeLabel}
                </span>
                <span className="h-px min-w-0 flex-1 bg-avatar-red" />
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgendaMonthChip({
  entry,
  onOpen,
}: {
  entry: SpaceAgendaEntry;
  onOpen: (entry: SpaceAgendaEntry) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "h-6 w-full justify-start gap-1 truncate rounded px-1.5 text-left text-[10px] font-medium",
        kindSurface(entry.kind),
      )}
      title={entry.title}
      onClick={() => onOpen(entry)}
    >
      <EntryIcon entry={entry} className="size-3 shrink-0" />
      <span className="truncate">
        {entry.all_day ? "" : `${formatTime(entry.starts_at)} `}
        {entry.title}
      </span>
    </Button>
  );
}

function AgendaAllDayChip({
  entry,
  onOpen,
}: {
  entry: SpaceAgendaEntry;
  onOpen: (entry: SpaceAgendaEntry) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "h-7 w-full justify-start gap-1.5 truncate rounded-md border px-2 text-left text-[11px] font-medium",
        kindSurface(entry.kind),
      )}
      onClick={() => onOpen(entry)}
    >
      <EntryIcon entry={entry} className="size-3.5 shrink-0" />
      <span className="truncate">{entry.title}</span>
    </Button>
  );
}

function AgendaTimedEvent({
  entry,
  hourHeight,
  minimumMinutes,
  onOpen,
}: {
  entry: SpaceAgendaEntry;
  hourHeight: number;
  minimumMinutes: AgendaZoomMinutes;
  onOpen: (entry: SpaceAgendaEntry) => void;
}) {
  const startsAt = new Date(entry.starts_at);
  const endsAt = new Date(entry.ends_at);
  const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
  const durationMinutes = Math.max(
    minimumMinutes / 2,
    (endsAt.getTime() - startsAt.getTime()) / 60_000,
  );
  const top = (startMinutes / 60) * hourHeight;
  const height = Math.max(40, (durationMinutes / 60) * hourHeight);

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "absolute inset-x-1 z-10 h-auto min-h-7 items-start justify-start gap-1.5",
        "overflow-hidden rounded-md border px-2 py-1.5 text-left font-normal shadow-sm",
        kindSurface(entry.kind),
      )}
      style={{ top, height }}
      title={`${entry.title}, ${formatTimeRange(entry)}`}
      onClick={() => onOpen(entry)}
    >
      <EntryIcon entry={entry} className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold leading-4">{entry.title}</span>
        {height >= 38 ? (
          <span className="block truncate text-[9px] leading-3.5 opacity-75">
            {formatTimeRange(entry)}
          </span>
        ) : null}
      </span>
    </Button>
  );
}

function EntryIcon({ entry, className }: { entry: SpaceAgendaEntry; className?: string }) {
  if (entry.kind === "task") return <CheckSquare2 className={className} />;
  if (entry.kind === "event") return <CalendarDays className={className} />;
  return <GitFork className={className} />;
}

function kindSurface(kind: SpaceAgendaEntry["kind"]) {
  return kind === "task"
    ? "border-sage-fg/30 bg-sage-bg text-sage-fg hover:bg-sage-bg"
    : kind === "event"
      ? "border-sage-fg/30 bg-sage-bg text-sage-fg hover:bg-sage-bg"
      : kind === "roadmap_node"
        ? "border-sage-fg/30 bg-sage-bg text-sage-fg hover:bg-sage-bg"
        : "border-status-green/30 bg-status-green text-sage-fg hover:bg-status-green";
}

function isSameDay(left: Date, right: Date) {
  return dayKey(left) === dayKey(right);
}

function formatHour(hour: number) {
  return new Date(2026, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatTimeRange(entry: SpaceAgendaEntry) {
  return `${formatTime(entry.starts_at)} – ${formatTime(entry.ends_at)}`;
}
