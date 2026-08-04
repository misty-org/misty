import type { SpaceAgendaEntry } from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import { Button, cn } from "@/ui";
import { dayKey, groupAgendaEntries, startOfWeek } from "./agendaDates";

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
    <div className="min-w-[720px] overflow-hidden rounded-lg border border-border/70">
      <div className="grid grid-cols-7 border-b border-border/70 bg-muted/20">
        {days.slice(0, 7).map((day) => (
          <div
            className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground"
            key={day.toISOString()}
          >
            {day.toLocaleDateString(undefined, { weekday: "short" })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const items = grouped[dayKey(day)] ?? [];
          return (
            <section
              className={cn(
                "min-h-28 border-b border-r border-border/50 p-1.5",
                day.getMonth() !== anchor.getMonth() && "bg-muted/10 text-muted-foreground",
              )}
              key={day.toISOString()}
              aria-label={day.toDateString()}
            >
              <div className="mb-1 text-right text-[11px]">{day.getDate()}</div>
              <div className="grid gap-1">
                {items.slice(0, 4).map((entry) => (
                  <AgendaChip entry={entry} key={entry.id} onOpen={onOpen} />
                ))}
                {items.length > 4 ? (
                  <span className="px-1 text-[10px] text-muted-foreground">
                    +{items.length - 4} more
                  </span>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function AgendaWeekView({ anchor, entries, onOpen }: AgendaViewProps) {
  const start = startOfWeek(anchor);
  const grouped = groupAgendaEntries(entries);
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return day;
  });
  return (
    <div className="grid min-w-[720px] grid-cols-7 overflow-hidden rounded-lg border border-border/70">
      {days.map((day) => (
        <section
          className="min-h-[520px] border-r border-border/60 last:border-r-0"
          key={day.toISOString()}
        >
          <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 p-2 text-center">
            <div className="text-[10px] uppercase text-muted-foreground">
              {day.toLocaleDateString(undefined, { weekday: "short" })}
            </div>
            <div className="text-sm font-semibold">{day.getDate()}</div>
          </header>
          <div className="grid gap-1 p-1.5">
            {(grouped[dayKey(day)] ?? []).map((entry) => (
              <AgendaCard entry={entry} key={entry.id} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function AgendaListView({ entries, onOpen }: Omit<AgendaViewProps, "anchor">) {
  const grouped = groupAgendaEntries(entries);
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5">
      {Object.entries(grouped).map(([date, items]) => (
        <section key={date}>
          <h2 className="sticky top-0 z-10 m-0 border-b border-border/60 bg-background/95 px-1 py-2 text-sm font-semibold">
            {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </h2>
          <div className="divide-y divide-border/50">
            {items.map((entry) => (
              <AgendaCard entry={entry} key={entry.id} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface AgendaViewProps {
  anchor: Date;
  entries: SpaceAgendaEntry[];
  onOpen: (entry: SpaceAgendaEntry) => void;
}

function AgendaChip({
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
        "h-auto w-full justify-start truncate rounded px-1.5 py-1 text-left text-[10px] font-medium",
        kindClass(entry.kind),
      )}
      title={entry.title}
      onClick={() => onOpen(entry)}
    >
      {entry.all_day
        ? ""
        : `${new Date(entry.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} `}
      {entry.title}
    </Button>
  );
}

function AgendaCard({
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
      className="h-auto w-full items-start justify-start gap-3 rounded-md px-2 py-2.5 text-left font-normal hover:bg-muted/40"
      onClick={() => onOpen(entry)}
    >
      <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", kindDot(entry.kind))} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{entry.title}</span>
        <span className="block text-xs text-muted-foreground">
          {entry.all_day
            ? "All day"
            : new Date(entry.starts_at).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
          ·{" "}
          {entry.kind === "event"
            ? "Calendar"
            : entry.kind === "roadmap_node"
              ? roadmapNodeLabel(entry.roadmap_node_kind)
              : entry.kind[0].toUpperCase() + entry.kind.slice(1)}
        </span>
      </span>
    </Button>
  );
}

function kindClass(kind: SpaceAgendaEntry["kind"]) {
  return kind === "task"
    ? "bg-blue-500/15 text-blue-300"
    : kind === "event"
      ? "bg-violet-500/15 text-violet-300"
      : kind === "roadmap_node"
        ? "bg-amber-500/15 text-amber-300"
        : "bg-emerald-500/15 text-emerald-300";
}
function kindDot(kind: SpaceAgendaEntry["kind"]) {
  return kind === "task"
    ? "bg-blue-500"
    : kind === "event"
      ? "bg-violet-500"
      : kind === "roadmap_node"
        ? "bg-amber-500"
        : "bg-emerald-500";
}

function roadmapNodeLabel(kind: SpaceAgendaEntry["roadmap_node_kind"]) {
  if (!kind) return "Roadmap";
  return kind[0].toUpperCase() + kind.slice(1);
}
