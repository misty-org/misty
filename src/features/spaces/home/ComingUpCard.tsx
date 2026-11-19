import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { spaceIcons } from "@/shared/ui";
import { useNow } from "@/shared/hooks/useNow";
import { useSettingsStore } from "@/features/settings";
import { comingUpDays } from "./comingUpDays";
import { useSpaceCalendar } from "../calendar/useSpaceCalendar";
import type { SpaceCalendarEvent, SpaceTask } from "../planner/api";
import { useSpaceTasks } from "../planner/useSpaceTasks";
import { OverviewCard, OverviewEmpty, OverviewRow, OverviewRowsSkeleton } from "./OverviewCard";

const noTasks: SpaceTask[] = [];
const noEvents: SpaceCalendarEvent[] = [];

/** How many events and tasks the card shows. */
const shown = 5;
const dayMs = 86_400_000;

type Upcoming = {
  key: string;
  kind: "event" | "task";
  title: string;
  detail: string;
  /** When it starts (an event) or is due (a task). */
  at: Date;
  /** It runs now: an event that started and hasn't ended. */
  ongoing: boolean;
  /** Only a day, no clock time: an all-day event or a task's due date. */
  dayOnly: boolean;
  href: string;
};

const startOfDay = (value: Date | number) => {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day;
};

/** "Now", "Overdue", "Today 3:00 PM", "Tomorrow", "Thu", or "Nov 28". */
function whenLabel(item: Upcoming, now: number): string {
  if (item.ongoing) return "Now";
  const days = Math.round((startOfDay(item.at).getTime() - startOfDay(now).getTime()) / dayMs);
  if (days < 0) return "Overdue";
  const time = item.dayOnly
    ? ""
    : ` ${item.at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days < 7) return `${item.at.toLocaleDateString(undefined, { weekday: "short" })}${time}`;
  return item.at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const nextMonth = (now: number) => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
};

/**
 * What's next in the Space: its calendar events that haven't ended, and its open tasks due in the
 * next two weeks (or as far ahead as Settings › Space says) or already overdue, soonest first. Each row opens the event or task itself.
 */
export function ComingUpCard({ spaceId }: { spaceId: string }) {
  const now = useNow();
  const navigate = useNavigate();
  const base = `/spaces/${encodeURIComponent(spaceId)}`;
  const planner = useSpaceTasks(spaceId);
  // This month and the next, so the last days of a month still see what follows.
  const current = useSpaceCalendar(spaceId, new Date(now));
  const following = useSpaceCalendar(spaceId, nextMonth(now));
  // A read that failed with nothing saved counts as empty, so what did load still shows.
  const tasks = planner.tasks ?? (planner.loadFailed ? noTasks : undefined);
  const thisMonth = current.events ?? (current.loadFailed ? noEvents : undefined);
  const followingMonth = following.events;
  const failed = planner.loadFailed || current.loadFailed || following.loadFailed;
  const horizonDays = useSettingsStore((state) => comingUpDays(state.settings?.document));

  const upcoming = useMemo<Upcoming[] | undefined>(() => {
    if (!tasks || !thisMonth) return undefined;
    const events = new Map([...thisMonth, ...(followingMonth ?? [])].map((e) => [e.id, e]));
    const fromEvents = [...events.values()].flatMap((event): Upcoming[] => {
      const starts = new Date(event.starts_at);
      const ends = new Date(event.ends_at);
      if (Number.isNaN(starts.getTime()) || ends.getTime() <= now) return [];
      return [
        {
          key: `event:${event.id}`,
          kind: "event",
          title: event.title.trim() || "Untitled event",
          detail: event.location.trim() || "Calendar",
          at: starts,
          ongoing: starts.getTime() <= now,
          dayOnly: event.all_day,
          href: `${base}/calendar?${new URLSearchParams({ event: event.id, at: event.starts_at })}`,
        },
      ];
    });
    const horizon = startOfDay(now).getTime() + (horizonDays + 1) * dayMs;
    const fromTasks = tasks.flatMap((task): Upcoming[] => {
      if (!task.due_at || task.status === "done" || task.status === "canceled") return [];
      const due = new Date(task.due_at);
      if (Number.isNaN(due.getTime()) || due.getTime() >= horizon) return [];
      return [
        {
          key: `task:${task.id}`,
          kind: "task",
          title: task.title.trim() || "Untitled task",
          detail: "Planner",
          at: due,
          ongoing: false,
          dayOnly: true,
          href: `${base}/planner?${new URLSearchParams({ task: task.id })}`,
        },
      ];
    });
    return [...fromEvents, ...fromTasks]
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(0, shown);
  }, [tasks, thisMonth, followingMonth, now, base, horizonDays]);

  // Nothing ahead: the home leaves the block out rather than show an empty one. When a read
  // failed, "nothing ahead" isn't known, so the block stays and says so quietly.
  if (upcoming && !upcoming.length && !failed) return null;
  return (
    <OverviewCard title="Coming up">
      {!upcoming ? (
        <OverviewRowsSkeleton rows={3} kind="schedule" trailing="w-14" />
      ) : !upcoming.length ? (
        <OverviewEmpty>Couldn’t load what’s coming up</OverviewEmpty>
      ) : (
        upcoming.map((item) => {
          const Icon = item.kind === "event" ? spaceIcons.calendar : spaceIcons.planner;
          return (
            <OverviewRow
              key={item.key}
              kind="schedule"
              leading={<Icon aria-hidden="true" />}
              title={item.title}
              detail={item.detail}
              trailing={whenLabel(item, now)}
              onOpen={() => navigate(item.href)}
            />
          );
        })
      )}
    </OverviewCard>
  );
}
