import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";

export type AgendaView = "month" | "week" | "day";

export function agendaRange(anchor: Date, view: AgendaView) {
  if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const from = startOfWeek(first);
    const to = new Date(from);
    to.setDate(to.getDate() + 42);
    return { from, to };
  }
  const from = view === "week" ? startOfWeek(anchor) : startOfDay(anchor);
  const to = new Date(from);
  to.setDate(to.getDate() + (view === "week" ? 7 : 1));
  return { from, to };
}

export function moveAnchor(anchor: Date, view: AgendaView, direction: number) {
  const next = new Date(anchor);
  if (view === "month") next.setMonth(next.getMonth() + direction);
  else next.setDate(next.getDate() + direction * (view === "week" ? 7 : 1));
  return next;
}

export function agendaTitle(anchor: Date, view: AgendaView) {
  if (view === "month")
    return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (view === "day")
    return anchor.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const from = startOfWeek(anchor);
  const to = new Date(from);
  to.setDate(to.getDate() + 6);
  const fromLabel = from.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const toLabel =
    from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()
      ? `${to.getDate()}, ${to.getFullYear()}`
      : to.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
  return `${fromLabel} – ${toLabel}`;
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfWeek(date: Date) {
  const result = startOfDay(date);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

export function dayKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function groupAgendaEntries(entries: SpaceAgendaEntry[]) {
  return entries.reduce<Record<string, SpaceAgendaEntry[]>>((groups, entry) => {
    (groups[dayKey(entry.starts_at)] ??= []).push(entry);
    return groups;
  }, {});
}
