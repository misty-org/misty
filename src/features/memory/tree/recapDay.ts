import type { MemoryEvent } from "../recall";
import type { RecapThread } from "./memoryNodes";

const pad = (n: number) => String(n).padStart(2, "0");

const clock = (at: string) => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** A day's start and end, as this computer's clock has them. */
export function dayBounds(day: string) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** "Thursday, November 5", in the person's language. */
export function dayTitle(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** A thread's times, as the person's clock shows them. */
export function threadTime({ from, to }: Pick<RecapThread, "from" | "to">) {
  const show = (time: string) =>
    new Date(`2000-01-01T${time}:00`).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  return from === to ? show(from) : `${show(from)} to ${show(to)}`;
}

/** The last page read: finding it needs no model. Events come newest first. */
export function leftOffPage(events: MemoryEvent[]) {
  return events.find((event) => event.url);
}

/** What a day looks like with no written recap: its sites, busiest first. */
export function siteThreads(events: MemoryEvent[]): RecapThread[] {
  const sites = new Map<string, MemoryEvent[]>();
  for (const event of events) {
    if (!event.site) continue;
    sites.set(event.site, [...(sites.get(event.site) ?? []), event]);
  }
  return [...sites.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .map(([title, visits]) => ({
      title,
      from: clock(visits[visits.length - 1].occurred_at),
      to: clock(visits[0].occurred_at),
    }));
}
