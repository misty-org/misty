import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SpaceCalendarEvent, SpaceMember, SpaceTask } from "@/spaces/types";
import { memberName } from "./SpaceTaskPrimitives";

const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SpaceTaskCalendar({
  month,
  tasks,
  events,
  members,
  onMonth,
  onOpenTask,
  onOpenEvent,
}: {
  month: Date;
  tasks: SpaceTask[];
  events: SpaceCalendarEvent[];
  members: SpaceMember[];
  onMonth: (month: Date) => void;
  onOpenTask: (task: SpaceTask) => void;
  onOpenEvent: (event: SpaceCalendarEvent) => void;
}) {
  const days = calendarDays(month);

  return (
    <Card className="min-w-[720px] gap-0 overflow-hidden py-0">
      <header className="flex min-h-12 items-center justify-between border-b border-border/60 px-3">
        <Button
          size="icon"
          variant="ghost"
          type="button"
          onClick={() => onMonth(addMonths(month, -1))}
          aria-label="Previous month"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <strong className="text-sm">
            {month.toLocaleDateString([], { month: "long", year: "numeric" })}
          </strong>
        </div>
        <Button
          size="icon"
          variant="ghost"
          type="button"
          onClick={() => onMonth(addMonths(month, 1))}
          aria-label="Next month"
        >
          <ChevronRight className="size-4" />
        </Button>
      </header>

      <div className="grid grid-cols-7 border-b border-border/60 bg-muted/40">
        {weekDays.map((day) => (
          <span className="p-2 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground" key={day}>
            {day}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayTasks = tasks.filter((task) => task.due_at && sameDay(new Date(task.due_at), day));
          const dayEvents = events.filter((event) => sameDay(new Date(event.starts_at), day));
          const visibleEntries = dayEvents.length + dayTasks.length;
          const inMonth = day.getMonth() === month.getMonth();
          const today = sameDay(day, new Date());

          return (
            <div
              className={`min-h-28 border-b border-r border-border/60 p-1.5 last:border-r-0 ${inMonth ? "bg-card" : "bg-muted/25 text-muted-foreground"}`}
              key={day.toISOString()}
            >
              <span
                className={`grid size-6 place-items-center rounded-full text-[10px] ${today ? "bg-primary font-semibold text-primary-foreground" : ""}`}
              >
                {day.getDate()}
              </span>
              <div className="mt-1 grid gap-1">
                {dayEvents.slice(0, 3).map((event) => (
                  <Button
                    className="h-6 justify-start truncate rounded-md bg-sky-500/10 px-1.5 text-[10px] font-normal text-sky-700 hover:bg-sky-500/20 dark:text-sky-300"
                    variant="ghost"
                    type="button"
                    key={event.id}
                    onClick={() => onOpenEvent(event)}
                    title={event.title || "Busy"}
                  >
                    {event.all_day
                      ? ""
                      : `${new Date(event.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · `}
                    {event.title || "Busy"}
                  </Button>
                ))}
                {dayTasks.slice(0, 3).map((task) => (
                  <Button
                    className="h-6 justify-start truncate rounded-md border-l-2 border-violet-500 bg-violet-500/10 px-1.5 text-[10px] font-normal text-violet-700 hover:bg-violet-500/20 dark:text-violet-300"
                    variant="ghost"
                    title={`${task.task_key} · ${memberName(members, task.assignee_user_id)}`}
                    type="button"
                    key={task.id}
                    onClick={() => onOpenTask(task)}
                  >
                    {task.title}
                  </Button>
                ))}
                {visibleEntries > 6 ? (
                  <Badge className="w-fit px-1.5 py-0 text-[9px]" variant="secondary">
                    +{visibleEntries - 6} more
                  </Badge>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function addMonths(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
